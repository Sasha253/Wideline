import type { PgBoss } from "pg-boss";
import { cvConfig } from "../server/cv/config";
import {
  destroyInstance,
  INSTANCE_SELECT,
  markFailedToStart,
  markJobSettled,
} from "../server/cv/instances";
import { gpuProvider } from "../server/cv/providers";
import type { GpuProvider } from "../server/cv/providers/types";
import {
  CLIPS_RESEND_AFTER_MS,
  decideWatchdog,
  RESEND_AFTER_MS,
  type WatchdogJob,
} from "../server/cv/watchdog";
import { rawDb } from "../server/db/raw";
import { log } from "../server/log";
import { fromStatusesFor } from "../server/matches/status";
import { alertPlatformAdmins } from "../server/processing/alerts";
import {
  createClipsJob,
  findJob,
  jobLog,
  markAttemptFailed,
  type JobRef,
} from "../server/processing/jobs";
import { QUEUES } from "../server/queue";
import { sendClipsJob } from "./clips";
import { sendCvJob } from "./probe";

/**
 * The CV watchdog (C08; NFR07, NFR30): a scheduled job, every minute. It
 * applies decideWatchdog() (src/server/cv/watchdog.ts) so no GPU instance runs
 * up a bill after its job, and repairs CV jobs pg-boss lost: a cv job queued
 * for 5 minutes without starting is sent again (the send is idempotent), and
 * one whose pg-boss job failed for good, or vanished, while the row still says
 * queued or running (a dispatcher that crashed) is failed, its match too, and
 * platform admins are told. A failed cv or transcode job whose alert email
 * did not go out (alertPlatformAdmins gave its claim back) is alerted again,
 * from 5 minutes to 24 hours after it failed, so older failures from before
 * the alert existed never flood the inbox. The clock and the provider are
 * injectable.
 *
 * C09: a clips job queued for 10 minutes without starting is sent again, and
 * a succeeded cv job with no clips job (a match ingested before C09, or an
 * ingest whose clips job was lost) gets one, created and sent; both log
 * "repaired". Without this, the new required job would keep those matches in
 * Processing.
 */

export type WatchdogDeps = {
  provider?: GpuProvider;
  now?: () => Date;
  boss?: Pick<PgBoss, "getJobById">;
  resend?: typeof sendCvJob;
  /** C09: sends a clips job; the default goes through pg-boss. */
  sendClips?: (job: JobRef) => Promise<void>;
};

export type WatchdogSummary = {
  destroyed: number;
  failedToStart: number;
  resent: number;
  reconciled: number;
  realerted: number;
  clipsResent: number;
  clipsBackfilled: number;
};

/** An unsent alert is retried only for failures this recent (NFR30). */
export const REALERT_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function handleCvWatchdog(deps: WatchdogDeps = {}): Promise<WatchdogSummary> {
  const provider = deps.provider ?? gpuProvider();
  const now = (deps.now ?? (() => new Date()))();
  const resend = deps.resend ?? sendCvJob;
  const sendClips = deps.sendClips ?? sendClipsJob;
  const summary: WatchdogSummary = {
    destroyed: 0,
    failedToStart: 0,
    resent: 0,
    reconciled: 0,
    realerted: 0,
    clipsResent: 0,
    clipsBackfilled: 0,
  };

  const instances = await rawDb.gpuInstance.findMany({
    where: { status: { in: ["requested", "running", "destroying"] } },
    select: INSTANCE_SELECT,
  });
  const jobRows = await rawDb.processingJob.findMany({
    where: { id: { in: [...new Set(instances.map((i) => i.processingJobId))] } },
    select: { id: true, status: true, attempts: true, finishedAt: true, lastAttemptAt: true },
  });
  const jobsById = new Map<string, WatchdogJob>(jobRows.map((j) => [j.id, j]));
  let listed = null;
  try {
    listed = await provider.list();
  } catch (err) {
    // A provider that cannot list (the hourly stub) still gets the row rules.
    log.warn({ err: String(err), provider: provider.name }, "cv watchdog: provider list failed");
  }

  const byId = new Map(instances.map((i) => [i.id, i]));
  for (const action of decideWatchdog(
    instances,
    jobsById,
    listed,
    now,
    cvConfig().CV_MAX_JOB_SECONDS,
  )) {
    try {
      if (action.kind === "destroy") {
        const instance = byId.get(action.instanceId)!;
        if ((await destroyInstance(instance, action.reason, provider, now)) !== null) {
          summary.destroyed += 1;
        }
      } else if (action.kind === "failed_to_start") {
        await markFailedToStart(byId.get(action.instanceId)!, now);
        summary.failedToStart += 1;
      } else {
        await provider.destroy(action.providerInstanceId);
        summary.destroyed += 1;
        log.warn(
          { event: "orphan_destroyed", providerInstanceId: action.providerInstanceId },
          "gpu instance",
        );
      }
    } catch (err) {
      log.error({ err: String(err), action: action.kind }, "cv watchdog action failed");
    }
  }

  // Lost enqueues: queued, never started, for 5 minutes, on a match still processing.
  const stuck = await rawDb.processingJob.findMany({
    where: {
      type: "cv",
      status: "queued",
      attempts: 0,
      queuedAt: { lte: new Date(now.getTime() - RESEND_AFTER_MS) },
      match: { status: "processing" },
    },
    select: { id: true, organisationId: true },
    take: 100,
  });
  for (const s of stuck) {
    const job = await findJob(s.organisationId, s.id);
    if (!job) continue;
    await resend(job);
    jobLog("repaired", job, { reason: "resent" });
    summary.resent += 1;
  }

  // C09: lost clips sends, queued and never started for 10 minutes.
  const stuckClips = await rawDb.processingJob.findMany({
    where: {
      type: "clips",
      status: "queued",
      attempts: 0,
      queuedAt: { lte: new Date(now.getTime() - CLIPS_RESEND_AFTER_MS) },
      match: { status: "processing" },
    },
    select: { id: true, organisationId: true },
    take: 100,
  });
  for (const s of stuckClips) {
    const job = await findJob(s.organisationId, s.id);
    if (!job) continue;
    await sendClips(job);
    jobLog("repaired", job, { reason: "resent" });
    summary.clipsResent += 1;
  }

  // C09: succeeded cv jobs with no clips job (ingested before C09).
  const orphans = await rawDb.$queryRaw<
    { organisationId: string; matchId: string; videoId: string }[]
  >`
    SELECT cv."organisationId", cv."matchId", cv."videoId"
      FROM "ProcessingJob" cv
      JOIN "Match" m ON m."id" = cv."matchId" AND m."organisationId" = cv."organisationId"
     WHERE cv."type" = 'cv' AND cv."status" = 'succeeded' AND cv."videoId" IS NOT NULL
       AND m."status" = 'processing'
       AND NOT EXISTS (
         SELECT 1 FROM "ProcessingJob" c
          WHERE c."videoId" = cv."videoId" AND c."type" = 'clips')
     LIMIT 50`;
  for (const o of orphans) {
    const { job, created } = await rawDb.$transaction((tx) => createClipsJob(tx, o));
    if (created) jobLog("queued", job);
    await sendClips(job);
    jobLog("repaired", job, { reason: "backfilled" });
    summary.clipsBackfilled += 1;
  }

  // Jobs pg-boss gave up on while the row still says queued or running.
  const boss = deps.boss;
  if (boss) {
    const open = await rawDb.processingJob.findMany({
      where: {
        type: "cv",
        status: { in: ["queued", "running"] },
        attempts: { gt: 0 },
        lastAttemptAt: { lte: new Date(now.getTime() - RESEND_AFTER_MS) },
      },
      select: { id: true, organisationId: true },
      take: 100,
    });
    for (const o of open) {
      const job = await findJob(o.organisationId, o.id);
      if (!job) continue;
      const bossJob = await boss.getJobById(QUEUES.cv, job.bossJobId);
      // created, retry and active mean pg-boss still owns it.
      const lost =
        !bossJob ||
        bossJob.state === "failed" ||
        bossJob.state === "cancelled" ||
        bossJob.state === "completed";
      if (!lost) continue;
      const error = "worker lost: the dispatcher stopped before the job finished";
      const failedAt = now;
      await rawDb.$transaction(async (tx) => {
        if (!(await markAttemptFailed(job, { final: true, error }, tx, failedAt))) return;
        await tx.match.updateMany({
          where: {
            id: job.matchId,
            organisationId: job.organisationId,
            status: { in: fromStatusesFor("failed") },
          },
          data: { status: "failed" },
        });
      });
      const failedJob = { ...job, status: "failed" as const, finishedAt: failedAt };
      jobLog("failed", failedJob, { error, reason: "worker_lost" });
      await markJobSettled(job.id, failedAt);
      await alertPlatformAdmins(failedJob, "CV job lost by the dispatcher");
      summary.reconciled += 1;
    }
  }

  // Alerts whose email failed: the final-failure path gave its claim back.
  const unalerted = await rawDb.processingJob.findMany({
    where: {
      type: { in: ["cv", "transcode", "clips"] },
      status: "failed",
      alertedAt: null,
      finishedAt: {
        gte: new Date(now.getTime() - REALERT_WINDOW_MS),
        lte: new Date(now.getTime() - RESEND_AFTER_MS),
      },
    },
    select: { id: true, organisationId: true },
    take: 50,
  });
  for (const u of unalerted) {
    const job = await findJob(u.organisationId, u.id);
    if (!job) continue;
    if (await alertPlatformAdmins(job, "an earlier alert email failed to send")) {
      summary.realerted += 1;
    }
  }

  if (
    summary.destroyed ||
    summary.failedToStart ||
    summary.resent ||
    summary.reconciled ||
    summary.realerted ||
    summary.clipsResent ||
    summary.clipsBackfilled
  ) {
    log.info({ event: "cv_watchdog", ...summary }, "cv watchdog");
  }
  return summary;
}
