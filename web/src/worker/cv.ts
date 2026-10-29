import { createHash } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { cvConfig } from "../server/cv/config";
import { CvResultInvalid, MAX_RESULT_BYTES, parseCvResult } from "../server/cv/contract";
import { ingestCvResult } from "../server/cv/ingest";
import {
  callbackToken,
  destroyInstance,
  findInstance,
  INSTANCE_SELECT,
  markFailedToStart,
  markInstanceStarted,
  markJobSettled,
  requestInstance,
  type DestroyReason,
  type InstanceRef,
} from "../server/cv/instances";
import { gpuProvider } from "../server/cv/providers";
import type { GpuProvider } from "../server/cv/providers/types";
import { rawDb } from "../server/db/raw";
import { log } from "../server/log";
import { cvResultKey } from "../server/matches/keys";
import { fromStatusesFor } from "../server/matches/status";
import { alertPlatformAdmins } from "../server/processing/alerts";
import {
  findJob,
  isFinalAttempt,
  jobLog,
  markAttemptFailed,
  markRunning,
  redactJobError,
  type JobRef,
} from "../server/processing/jobs";
import type { CvJob } from "../server/queue";
import { bucket, s3Internal } from "../server/storage";

/**
 * The CV job (C08; CV01, CV09, CV10, NFR04, NFR06, NFR07, NFR30, NFR31). One
 * delivery is one attempt: it starts a GPU instance (one GpuInstance row per
 * attempt, so a replay reuses it), hands it signed URLs for the raw footage
 * and its result file plus a callback token, then polls the row until the
 * worker reports through the callback route, the instance exits, or the
 * deadline passes. The instance is destroyed (and its cost recorded) before
 * the result is read, so billing stops at once. The result is checked against
 * the contract and ingested in one transaction (src/server/cv/ingest.ts).
 *
 * A failed attempt is recorded and rethrown (redacted) so pg-boss retries it;
 * the third failure marks the job and the match failed, pg-boss dead-letters
 * it, and platform admins get one email (NFR30). Every state change is one
 * "processing job" log line (NFR31), ids and counts only. The instance's
 * environment carries ids and signed URLs, never names or lineups.
 */

/** How often the handler checks the instance while it runs. */
export const POLL_MS = 10_000;
/** The video the worker samples at (CV02). */
export const SAMPLED_FPS = 5;

export type CvMeta = { retryCount: number; retryLimit: number };
export type CvOutcome = "succeeded" | "skipped";

export type LoadedResult = { json: unknown; bytes: number; sha256: string };

export type CvDeps = {
  provider?: GpuProvider;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  /** Reads the result file; the default checks its size first and hashes it. */
  loadResult?: (key: string) => Promise<LoadedResult>;
};

/** Reads a result from object storage: size-capped, sha256 computed. */
export async function loadResultFromStorage(key: string): Promise<LoadedResult> {
  const head = await s3Internal().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
  if ((head.ContentLength ?? 0) > MAX_RESULT_BYTES) throw new Error("CV result file too large");
  const res = await s3Internal().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const body = Buffer.from(await res.Body!.transformToByteArray());
  return {
    json: JSON.parse(body.toString("utf8")),
    bytes: body.length,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
}

const LIVE = ["requested", "running", "destroying"] as const;

/** Destroys every live instance of a job, optionally only attempts before `beforeAttempt`. */
async function destroyLive(
  processingJobId: string,
  reason: DestroyReason,
  provider: GpuProvider,
  now: Date,
  beforeAttempt?: number,
): Promise<void> {
  const rows = await rawDb.gpuInstance.findMany({
    where: {
      processingJobId,
      status: { in: [...LIVE] },
      ...(beforeAttempt !== undefined && { attempt: { lt: beforeAttempt } }),
    },
    select: INSTANCE_SELECT,
  });
  for (const row of rows) await destroyInstance(row, reason, provider, now);
}

/** The attempt failed for this reason; the message reaches the job row redacted. */
class AttemptFailed extends Error {}
/** The job or its match went away mid-attempt. */
class JobGone extends Error {}

export async function handleCvJob(
  data: CvJob,
  meta: CvMeta,
  deps: CvDeps = {},
): Promise<CvOutcome> {
  const provider = deps.provider ?? gpuProvider();
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = deps.pollMs ?? POLL_MS;
  const loadResult = deps.loadResult ?? loadResultFromStorage;
  const cfg = cvConfig();
  const { organisationId, videoId, processingJobId } = data;

  const row = await findJob(organisationId, processingJobId);
  const video = await rawDb.video.findFirst({
    where: { id: videoId, organisationId },
    select: {
      status: true,
      deletedAt: true,
      blobPath: true,
      matchId: true,
      durationSec: true,
      fps: true,
      match: { select: { status: true } },
    },
  });
  if (!row || !video || row.videoId !== videoId || row.type !== "cv") {
    // The match was deleted (its rows cascade). Stop anything still billing.
    await destroyLive(processingJobId, "job_gone", provider, now());
    log.info({ organisationId, videoId, processingJobId }, "cv skipped: job or video gone");
    return "skipped";
  }
  if (row.status === "succeeded" || row.status === "failed") {
    await destroyLive(row.id, "outlived", provider, now());
    jobLog("skipped", row, { reason: `already_${row.status}` });
    return "skipped";
  }
  if (video.status !== "accepted" || video.deletedAt || video.match.status !== "processing") {
    // The transcode failed for good, or the footage went: nothing to find
    // events in. Settle the job so nothing resends it. No alert: the failure
    // that moved the match already sent one.
    await markAttemptFailed(row, { final: true, error: "match is no longer processing" });
    await markJobSettled(row.id, now());
    jobLog("skipped", row, { reason: "match_not_processing" });
    return "skipped";
  }

  const attempt = meta.retryCount + 1;
  const job = await markRunning(row, attempt, now());
  if (!job) {
    jobLog("skipped", row, { reason: "attempt_already_started", attemptDelivered: attempt });
    return "skipped";
  }
  jobLog("started", job);

  const resultKey = cvResultKey(organisationId, video.matchId, job.id, attempt);
  const durationMs = video.durationSec ? Math.round(video.durationSec * 1000) : null;
  let videoUrl: string | undefined;
  let instance: InstanceRef | undefined;
  try {
    // Attempts that did not destroy their instance (a crashed handler).
    await destroyLive(job.id, "attempt_failed", provider, now(), attempt);

    instance = await requestInstance(job, attempt, provider, now());
    if (!instance.providerInstanceId && instance.status === "requested") {
      const ttl = cfg.CV_MAX_JOB_SECONDS;
      videoUrl = await getSignedUrl(
        s3Internal(),
        new GetObjectCommand({ Bucket: bucket(), Key: video.blobPath }),
        { expiresIn: ttl },
      );
      const resultUrl = await getSignedUrl(
        s3Internal(),
        new PutObjectCommand({ Bucket: bucket(), Key: resultKey, ContentType: "application/json" }),
        { expiresIn: ttl },
      );
      const spec = {
        jobId: job.id,
        matchId: video.matchId,
        instanceId: instance.id,
        attempt,
        videoUrl,
        resultUrl,
        callbackUrl: `${cfg.CV_CALLBACK_BASE_URL.replace(/\/$/, "")}/api/jobs/${job.id}/callback`,
        callbackToken: callbackToken(instance.id, job.id),
        sampledFps: SAMPLED_FPS,
        durationSec: video.durationSec,
        fps: video.fps,
      };
      try {
        const started = await provider.start({
          instanceId: instance.id,
          processingJobId: job.id,
          image: cfg.CV_WORKER_IMAGE,
          env: { WIDELINE_JOB: JSON.stringify(spec) },
        });
        instance = await markInstanceStarted(instance, started.providerInstanceId, now());
      } catch (err) {
        await markFailedToStart(instance, now());
        throw err;
      }
      jobLog("instance_started", job, {
        gpuInstanceId: instance.id,
        provider: provider.name,
        startupMs: instance.startedAt!.getTime() - instance.requestedAt.getTime(),
      });
    }

    if (instance.status !== "running" || !instance.providerInstanceId) {
      throw new AttemptFailed("instance did not start");
    }
    const settled = await waitForResult(instance, job, provider, { now, sleep, pollMs, cfg });
    // Billing stops before the result is read.
    await destroyInstance(settled, "job_done", provider, now());
    if (settled.resultStatus !== "succeeded") {
      throw new AttemptFailed(settled.resultError ?? "worker reported a failure");
    }

    const loaded = await loadResult(resultKey);
    if (settled.resultSha256 && loaded.sha256 !== settled.resultSha256) {
      throw new AttemptFailed("result file does not match the worker's checksum");
    }
    const result = parseCvResult(loaded.json, {
      jobId: job.id,
      matchId: video.matchId,
      durationMs,
    });
    const ranMs =
      settled.resultAt && settled.startedAt
        ? settled.resultAt.getTime() - settled.startedAt.getTime()
        : null;
    const outcome = await ingestCvResult({
      job,
      videoId,
      result,
      resultKey,
      resultBytes: loaded.bytes,
      resultSha256: loaded.sha256,
      attempt,
      provider: provider.name,
      realtimeFactor: ranMs !== null && durationMs ? Number((ranMs / durationMs).toFixed(4)) : null,
      startupMs: settled.startedAt
        ? settled.startedAt.getTime() - settled.requestedAt.getTime()
        : null,
      now: now(),
    });
    await markJobSettled(job.id, now());
    if (!outcome.ingested) {
      jobLog("skipped", job, { reason: "job_settled_before_ingest" });
      return "skipped";
    }
    jobLog("ingested", job, { ...outcome.counts, matchReady: outcome.matchReady });
    jobLog("succeeded", { ...job, status: "succeeded", finishedAt: now() });
    return "succeeded";
  } catch (err) {
    if (err instanceof JobGone) {
      await destroyLive(job.id, "job_gone", provider, now());
      jobLog("skipped", job, { reason: "job_gone" });
      return "skipped";
    }
    if (instance) await destroyLive(job.id, "attempt_failed", provider, now());
    const error =
      err instanceof CvResultInvalid
        ? redactJobError(err, { videoId })
        : redactJobError(err, { url: videoUrl, videoId });
    const final = isFinalAttempt(meta.retryCount, meta.retryLimit);
    const failedAt = now();
    await rawDb.$transaction(async (tx) => {
      await markAttemptFailed(job, { final, error }, tx, failedAt);
      if (final) {
        await tx.match.updateMany({
          where: { id: video.matchId, organisationId, status: { in: fromStatusesFor("failed") } },
          data: { status: "failed" },
        });
      }
    });
    const failedJob: JobRef = {
      ...job,
      status: final ? "failed" : "queued",
      finishedAt: final ? failedAt : null,
    };
    jobLog(final ? "failed" : "attempt_failed", failedJob, { error });
    if (final) {
      await markJobSettled(job.id, failedAt);
      await alertPlatformAdmins(failedJob, "CV job failed 3 times");
    }
    throw new Error(`cv failed: ${error}`);
  }
}

/**
 * Polls the instance row until the worker has reported, the instance exited
 * without a report, or the deadline passed. Throws JobGone when the job row
 * disappears (match deleted) and AttemptFailed for the rest.
 */
async function waitForResult(
  instance: InstanceRef,
  job: JobRef,
  provider: GpuProvider,
  {
    now,
    sleep,
    pollMs,
    cfg,
  }: {
    now: () => Date;
    sleep: (ms: number) => Promise<void>;
    pollMs: number;
    cfg: ReturnType<typeof cvConfig>;
  },
): Promise<InstanceRef> {
  const startedAt = instance.startedAt ?? instance.requestedAt;
  const deadline = startedAt.getTime() + cfg.CV_MAX_JOB_SECONDS * 1000;
  for (;;) {
    const row = await findInstance(instance.id);
    if (!row) throw new JobGone();
    if (row.resultStatus) return row;
    if (row.status === "destroyed" || row.status === "destroying") {
      // The watchdog destroyed it (idle, or past its time).
      throw new AttemptFailed("instance stopped by the watchdog");
    }
    if (!(await findJob(job.organisationId, job.id))) throw new JobGone();
    if (row.providerInstanceId) {
      const state = await provider.status(row.providerInstanceId);
      if (state === "exited" || state === "gone") {
        const last = await findInstance(instance.id);
        if (last?.resultStatus) return last;
        throw new AttemptFailed("worker exited without a result");
      }
    }
    if (now().getTime() >= deadline) throw new AttemptFailed("CV attempt ran past its deadline");
    await sleep(pollMs);
  }
}
