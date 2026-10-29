// No "server-only" marker: the worker (plain Node, src/worker/) runs these.
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { ProcessingJobStatus, ProcessingJobType } from "@/generated/prisma/enums";
import { rawDb } from "../db/raw";
import { log } from "../log";
import { redactProbeError } from "./redact";

/**
 * ProcessingJob rows (C07; MATCH06, NFR06, NFR30, NFR31): one per job, with
 * its state, attempts, timings and last error. pg-boss runs the job; this row
 * is what the match page and C18's admin views read.
 *
 * Every write is a guarded updateMany on the current status, so a retried or
 * replayed job changes nothing twice (NFR06). Every call takes an explicit
 * organisationId and touches only that organisation's rows, so it uses the raw
 * client (ESLint allowlist), as the usage meter does.
 *
 * Job history (NFR31): every state change is one structured log line, msg
 * "processing job", with `event` one of queued, enqueued, started, progress,
 * succeeded, attempt_failed, failed or skipped (C08 adds instance_started,
 * ingested and repaired for CV jobs), and ids, attempt numbers and
 * timings only, never names. Filtering the logs by processingJobId rebuilds a
 * job's whole history.
 */

export const ERROR_MESSAGE_MAX = 500;

export type JobRef = {
  id: string;
  organisationId: string;
  matchId: string;
  videoId: string | null;
  type: ProcessingJobType;
  status: ProcessingJobStatus;
  bossJobId: string;
  attempts: number;
  maxAttempts: number;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

const JOB_SELECT = {
  id: true,
  organisationId: true,
  matchId: true,
  videoId: true,
  type: true,
  status: true,
  bossJobId: true,
  attempts: true,
  maxAttempts: true,
  queuedAt: true,
  startedAt: true,
  finishedAt: true,
} as const;

export type JobEvent =
  | "queued"
  | "enqueued"
  | "started"
  | "progress"
  | "succeeded"
  | "attempt_failed"
  | "failed"
  | "skipped"
  // C08: the CV job's GPU instance, its ingest, and watchdog repairs.
  | "instance_started"
  | "ingested"
  | "repaired";

const LEVEL: Record<JobEvent, "info" | "warn" | "error"> = {
  queued: "info",
  enqueued: "info",
  started: "info",
  progress: "info",
  succeeded: "info",
  attempt_failed: "warn",
  // NFR30: the final failure; platform admins are emailed once
  // (src/server/processing/alerts.ts).
  failed: "error",
  skipped: "info",
  instance_started: "info",
  ingested: "info",
  repaired: "warn",
};

/** Extra fields a job log line may carry: numbers, ids and short codes only. */
export type JobLogExtra = Record<string, string | number | boolean | null | undefined>;

/**
 * Writes one job history line. `attempt` defaults to the row's attempts;
 * timings are ISO strings. Never pass names or error text with a URL in it
 * (use redactJobError first).
 */
export function jobLog(event: JobEvent, job: JobRef, extra: JobLogExtra = {}): void {
  log[LEVEL[event]](
    {
      event,
      processingJobId: job.id,
      bossJobId: job.bossJobId,
      type: job.type,
      organisationId: job.organisationId,
      matchId: job.matchId,
      videoId: job.videoId,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
      queuedAt: job.queuedAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
      ...extra,
    },
    "processing job",
  );
}

/**
 * Error text fit for a ProcessingJob row and a log line: any signed URL
 * replaced (the exact URL by the video id, others cut at the query string),
 * then capped at 500 characters.
 */
export function redactJobError(
  err: unknown,
  { url, videoId }: { url?: string; videoId: string },
): string {
  const text = err instanceof Error ? err.message : String(err);
  const redacted = redactProbeError(text, url ?? "", videoId).trim() || "Unknown error";
  return redacted.length > ERROR_MESSAGE_MAX
    ? `${redacted.slice(0, ERROR_MESSAGE_MAX - 1)}…`
    : redacted;
}

/** True when pg-boss will not retry this attempt: retryCount has reached retryLimit (NFR30). */
export function isFinalAttempt(retryCount: number, retryLimit: number): boolean {
  return retryCount >= retryLimit;
}

/** The row change for a failed attempt: back to queued for a retry, or failed for good. */
export function failureUpdate(
  { final, error }: { final: boolean; error: string },
  now: Date,
): Prisma.ProcessingJobUpdateManyMutationInput {
  return {
    status: final ? "failed" : "queued",
    errorMessage: error,
    finishedAt: final ? now : null,
  };
}

type VideoRef = { organisationId: string; matchId: string; videoId: string };

/**
 * Creates the video's job of this type, in the caller's transaction, or
 * returns the one it already has (the unique "ProcessingJob_video_type_key"
 * holds one per video and type). The pg-boss job id is made here, so every
 * later send names the same job.
 */
async function createJob(
  tx: Prisma.TransactionClient,
  type: ProcessingJobType,
  { organisationId, matchId, videoId }: VideoRef,
): Promise<{ job: JobRef; created: boolean }> {
  const { count } = await tx.processingJob.createMany({
    data: [{ organisationId, matchId, videoId, type, bossJobId: randomUUID() }],
    skipDuplicates: true,
  });
  const job = await tx.processingJob.findFirstOrThrow({
    where: { organisationId, videoId, type },
    select: JOB_SELECT,
  });
  return { job, created: count === 1 };
}

/** The video's transcode job (C07), created in the probe's transaction. */
export function createTranscodeJob(tx: Prisma.TransactionClient, video: VideoRef) {
  return createJob(tx, "transcode", video);
}

/** The video's CV job (C08), created next to the transcode job: the two run in parallel. */
export function createCvJob(tx: Prisma.TransactionClient, video: VideoRef) {
  return createJob(tx, "cv", video);
}

async function jobFor(
  organisationId: string,
  videoId: string,
  type: ProcessingJobType,
): Promise<JobRef | null> {
  return rawDb.processingJob.findFirst({
    where: { organisationId, videoId, type },
    select: JOB_SELECT,
  });
}

/** The video's transcode job, or null. */
export function transcodeJobFor(organisationId: string, videoId: string): Promise<JobRef | null> {
  return jobFor(organisationId, videoId, "transcode");
}

/** The video's CV job, or null. */
export function cvJobFor(organisationId: string, videoId: string): Promise<JobRef | null> {
  return jobFor(organisationId, videoId, "cv");
}

/** One job by id, in its organisation, or null. */
export async function findJob(organisationId: string, id: string): Promise<JobRef | null> {
  return rawDb.processingJob.findFirst({ where: { id, organisationId }, select: JOB_SELECT });
}

/**
 * Marks attempt `attempt` (1-based) running. Only a queued or running job
 * whose attempts are below `attempt` moves, so a replayed delivery of an
 * attempt already started changes nothing. Returns the updated job, or null.
 */
export async function markRunning(
  job: JobRef,
  attempt: number,
  now = new Date(),
): Promise<JobRef | null> {
  if (attempt > job.maxAttempts) return null;
  const { count } = await rawDb.processingJob.updateMany({
    where: {
      id: job.id,
      organisationId: job.organisationId,
      status: { in: ["queued", "running"] },
      attempts: { lt: attempt },
    },
    data: {
      status: "running",
      attempts: attempt,
      startedAt: job.startedAt ?? now,
      lastAttemptAt: now,
      finishedAt: null,
    },
  });
  if (count === 0) return null;
  return { ...job, status: "running", attempts: attempt, startedAt: job.startedAt ?? now };
}

/**
 * Marks a running job succeeded with its metadata, in the caller's
 * transaction. Returns false when it was not running (a replay).
 */
export async function markSucceeded(
  tx: Prisma.TransactionClient,
  job: JobRef,
  metadata: Prisma.InputJsonValue,
  now = new Date(),
): Promise<boolean> {
  const { count } = await tx.processingJob.updateMany({
    where: { id: job.id, organisationId: job.organisationId, status: "running" },
    data: { status: "succeeded", finishedAt: now, errorMessage: null, metadata },
  });
  return count === 1;
}

/**
 * Records a failed attempt: the job goes back to queued for pg-boss's retry,
 * or to failed on the final attempt. `error` must already be redacted.
 * Returns false when the job was neither queued nor running.
 */
export async function markAttemptFailed(
  job: JobRef,
  { final, error }: { final: boolean; error: string },
  tx: Prisma.TransactionClient = rawDb,
  now = new Date(),
): Promise<boolean> {
  const { count } = await tx.processingJob.updateMany({
    where: {
      id: job.id,
      organisationId: job.organisationId,
      status: { in: ["queued", "running"] },
    },
    data: failureUpdate({ final, error }, now),
  });
  return count === 1;
}
