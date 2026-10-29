import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { clipSize, ffmpegClipArgs, runFfmpegClip, type ClipWindow } from "../server/clips/cut";
import { clipExpiry } from "../server/clips/expiry";
import { clipKey } from "../server/clips/keys";
import { rawDb } from "../server/db/raw";
import { log } from "../server/log";
import { fromStatusesFor } from "../server/matches/status";
import { alertPlatformAdmins } from "../server/processing/alerts";
import {
  cvJobFor,
  findJob,
  isFinalAttempt,
  jobLog,
  markAttemptFailed,
  markRunning,
  markSucceeded,
  redactJobError,
  type JobRef,
} from "../server/processing/jobs";
import { moveToAwaitingReviewIfReady } from "../server/processing/readiness";
import { CLIPS_JOB_OPTIONS, getBoss, QUEUES, type ClipsJob } from "../server/queue";
import { bucket, s3Internal } from "../server/storage";
import { recordUsage } from "../server/usage/meter";
import { runFfprobe } from "./probe";

/**
 * The clips job (C09; CV11, NFR06, NFR30, NFR31): after the CV ingest, cut one
 * MP4 per event from the raw footage (A-8) and store it under the match
 * prefix (src/server/clips/keys.ts). It runs on the transcode worker, in
 * parallel with the transcode, CLIPS_CONCURRENCY ffmpeg processes at a time.
 *
 * Idempotent: only events of the cv job with a clip window and no Clip row
 * are cut; each clip commits on its own (Clip row plus storage_bytes usage,
 * sourceType "Clip", sourceId the clip id, metadata.matchId), so a retry after
 * a crash cuts only what is missing and counts usage once. When every event
 * has its clip, one transaction marks the job succeeded and moves the match to
 * Awaiting review if the other jobs are done. Zero events succeed at once.
 *
 * Clip.expiresAt starts at Video.uploadedAt + 14 days (clipExpiry); a very
 * late retry past that still creates the row, and C17's sweep removes it. A
 * failed attempt is recorded (redacted) and rethrown for pg-boss's retry; the
 * third failure marks the match failed and alerts the platform admins once.
 * Clips of events kept at team level after the consent gate are cut too
 * (Q-047): the clip links to no player.
 */

/** ffmpeg processes at once per worker (each is short). */
export const CLIPS_CONCURRENCY = Number(process.env.CLIPS_CONCURRENCY) || 2;
const SOURCE_URL_TTL_SEC = 3 * 3600;

export type CutInput = {
  url: string;
  key: string;
  window: ClipWindow;
  source: { width: number; height: number };
  hasAudio: boolean;
};

/** ffprobe, ffmpeg and storage, injectable for tests. */
export type ClipCutter = {
  sourceUrl: (blobPath: string) => Promise<string>;
  hasAudio: (url: string, videoId: string) => Promise<boolean>;
  /** Cuts one clip, stores it at `key`, and returns its size in bytes. */
  cut: (input: CutInput) => Promise<number>;
};

export const defaultCutter: ClipCutter = {
  sourceUrl: (blobPath) =>
    getSignedUrl(s3Internal(), new GetObjectCommand({ Bucket: bucket(), Key: blobPath }), {
      expiresIn: SOURCE_URL_TTL_SEC,
    }),
  async hasAudio(url, videoId) {
    const out = await runFfprobe(url, videoId);
    return !!out?.streams?.some((s) => s.codec_type === "audio");
  },
  async cut({ url, key, window, source, hasAudio }) {
    const dir = await mkdtemp(join(process.env.TRANSCODE_TMP_DIR || tmpdir(), "wl-clip-"));
    try {
      const out = join(dir, "clip.mp4");
      await runFfmpegClip(ffmpegClipArgs(url, out, window, source, hasAudio));
      const bytes = (await stat(out)).size;
      await s3Internal().send(
        new PutObjectCommand({
          Bucket: bucket(),
          Key: key,
          Body: await readFile(out),
          ContentType: "video/mp4",
        }),
      );
      return bytes;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};

export type ClipsMeta = { retryCount: number; retryLimit: number };
export type ClipsOutcome = "succeeded" | "skipped";

/** Sends a clips job that has not started. Used after the ingest and by the watchdog. */
export async function sendClipsJob(row: JobRef): Promise<void> {
  if (row.status !== "queued" || row.attempts > 0 || !row.videoId) return;
  const boss = await getBoss();
  const payload: ClipsJob = {
    organisationId: row.organisationId,
    videoId: row.videoId,
    processingJobId: row.id,
  };
  const sent = await boss.send(QUEUES.clips, payload, {
    id: row.bossJobId,
    ...CLIPS_JOB_OPTIONS,
  });
  jobLog("enqueued", row, { duplicate: sent === null });
}

/** Runs `work` over items, `limit` at a time; the first error stops new work and is thrown. */
async function eachLimited<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  let failed: unknown = null;
  const lane = async () => {
    while (failed === null && next < items.length) {
      const item = items[next++]!;
      try {
        await work(item);
      } catch (err) {
        failed ??= err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  if (failed !== null) throw failed;
}

type ClipEvent = { id: string; clipStartMs: number | null; clipEndMs: number | null };

/** Events of the cv job with a clip window and no clip yet. */
function clipless(organisationId: string, cvJobId: string): Promise<ClipEvent[]> {
  return rawDb.event.findMany({
    where: {
      organisationId,
      jobId: cvJobId,
      clipStartMs: { not: null },
      clipEndMs: { not: null },
      clip: { is: null },
    },
    orderBy: { timestampMs: "asc" },
    select: { id: true, clipStartMs: true, clipEndMs: true },
  });
}

/** The event's clip window clamped to the footage, or null when nothing is left of it. */
export function windowFor(e: ClipEvent, durationMs: number | null): ClipWindow | null {
  if (e.clipStartMs === null || e.clipEndMs === null) return null;
  const startMs = Math.max(0, e.clipStartMs);
  const endMs = durationMs === null ? e.clipEndMs : Math.min(durationMs, e.clipEndMs);
  return endMs > startMs ? { startMs, endMs } : null;
}

/** Thrown inside the success transaction to roll it back when the job settled meanwhile. */
class Settled extends Error {}

export async function handleClips(
  data: ClipsJob,
  meta: ClipsMeta,
  deps: { cutter?: ClipCutter; now?: () => Date; concurrency?: number } = {},
): Promise<ClipsOutcome> {
  const cutter = deps.cutter ?? defaultCutter;
  const now = deps.now ?? (() => new Date());
  const { organisationId, videoId, processingJobId } = data;

  const row = await findJob(organisationId, processingJobId);
  const video = await rawDb.video.findFirst({
    where: { id: videoId, organisationId },
    select: {
      status: true,
      deletedAt: true,
      blobPath: true,
      matchId: true,
      width: true,
      height: true,
      durationSec: true,
      uploadedAt: true,
      match: { select: { status: true } },
    },
  });
  if (!row || !video || row.videoId !== videoId || row.type !== "clips") {
    log.info({ organisationId, videoId, processingJobId }, "clips skipped: job or video gone");
    return "skipped";
  }
  if (row.status === "succeeded" || row.status === "failed") {
    jobLog("skipped", row, { reason: `already_${row.status}` });
    return "skipped";
  }
  if (video.status !== "accepted" || video.deletedAt || video.match.status !== "processing") {
    // The footage went or the match failed: nothing to cut. Settle the job so
    // nothing resends it; the failure that moved the match already alerted.
    await markAttemptFailed(row, { final: true, error: "match is no longer processing" });
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

  const durationMs = video.durationSec ? Math.round(video.durationSec * 1000) : null;
  const source = { width: video.width ?? 1920, height: video.height ?? 1080 };
  const size = clipSize(source);
  if (!video.uploadedAt) {
    // An accepted video always has uploadedAt; without it the clock starts now.
    log.warn(
      { organisationId, videoId, jobId: job.id },
      "clips: video has no uploadedAt, clip expiry counts from now",
    );
  }
  const expiresAt = clipExpiry(video.uploadedAt ?? now());
  let url: string | undefined;
  try {
    const cv = await cvJobFor(organisationId, videoId);
    const events = cv ? await clipless(organisationId, cv.id) : [];
    const started = Date.now();
    let cut = 0;
    let bytes = 0;
    if (events.length) {
      url = await cutter.sourceUrl(video.blobPath);
      const hasAudio = await cutter.hasAudio(url, videoId);
      await eachLimited(events, deps.concurrency ?? CLIPS_CONCURRENCY, async (e) => {
        const window = windowFor(e, durationMs);
        if (!window) return;
        const { startMs, endMs } = window;
        const key = clipKey(organisationId, video.matchId, e.id);
        const sizeBytes = await cutter.cut({
          url: url!,
          key,
          window: { startMs, endMs },
          source,
          hasAudio,
        });
        await rawDb.$transaction(async (tx) => {
          const made = await tx.clip.createMany({
            data: [
              {
                organisationId,
                matchId: video.matchId,
                eventId: e.id,
                processingJobId: job.id,
                blobPath: key,
                startMs,
                endMs,
                sizeBytes: BigInt(sizeBytes),
                width: size.width,
                height: size.height,
                baseExpiresAt: expiresAt,
                expiresAt,
              },
            ],
            skipDuplicates: true,
          });
          const clip = await tx.clip.findFirst({
            where: { organisationId, eventId: e.id },
            select: { id: true, sizeBytes: true },
          });
          if (!clip) return;
          await recordUsage(
            {
              organisationId,
              metric: "storage_bytes",
              quantity: clip.sizeBytes,
              sourceType: "Clip",
              sourceId: clip.id,
              metadata: { matchId: video.matchId, processingJobId: job.id, eventId: e.id },
            },
            tx,
          );
          if (made.count === 1) {
            cut += 1;
            bytes += sizeBytes;
          }
        });
      });
    }
    // Every event with a window inside the footage must have its clip now.
    const left = cv ? await clipless(organisationId, cv.id) : [];
    const missing = left.filter((e) => windowFor(e, durationMs) !== null).length;
    if (missing > 0) throw new Error(`${missing} clips are still missing`);
    const total = await rawDb.clip.aggregate({
      where: { organisationId, processingJobId: job.id },
      _count: true,
      _sum: { sizeBytes: true },
    });
    const metadata = {
      count: total._count,
      bytes: Number(total._sum.sizeBytes ?? 0),
      cutThisAttempt: cut,
      bytesThisAttempt: bytes,
      cutMs: Date.now() - started,
      events: events.length,
    };
    const finishedAt = now();
    try {
      await rawDb.$transaction(async (tx) => {
        if (!(await markSucceeded(tx, job, metadata, finishedAt))) throw new Settled();
        await moveToAwaitingReviewIfReady(tx, { organisationId, matchId: video.matchId, videoId });
      });
    } catch (err) {
      if (!(err instanceof Settled)) throw err;
      jobLog("skipped", job, { reason: "job_settled" });
      return "skipped";
    }
    jobLog("succeeded", { ...job, status: "succeeded", finishedAt }, metadata);
    return "succeeded";
  } catch (err) {
    const error = redactJobError(err, { url, videoId });
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
    if (final) await alertPlatformAdmins(failedJob, "clips job failed 3 times");
    throw new Error(`clips failed: ${error}`);
  }
}
