import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { rawDb } from "../server/db/raw";
import { log } from "../server/log";
import { fromStatusesFor } from "../server/matches/status";
import { alertPlatformAdmins } from "../server/processing/alerts";
import {
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
import type { TranscodeJob } from "../server/queue";
import { bucket, s3Internal } from "../server/storage";
import {
  contentTypeFor,
  ffmpegArgs,
  FILE_PATTERN,
  hlsKeys,
  INIT_SEGMENT,
  ladderFor,
  MASTER_PLAYLIST,
  MEDIA_PLAYLIST,
  normaliseInitName,
  progressMs,
  type Rendition,
  type RenditionName,
} from "../server/transcode/ladder";
import { recordUsage } from "../server/usage/meter";
import { runFfprobe } from "./probe";

/**
 * The transcode job (MATCH06, NFR03, NFR06, NFR30, NFR31): one ffmpeg run
 * turns the accepted raw footage into the HLS ladder
 * (src/server/transcode/ladder.ts) in a local temp dir, the files go to object
 * storage under the match prefix (master playlist last), and one transaction
 * sets Video.hlsManifestPath, marks the ProcessingJob succeeded with its
 * timings, and records storage_bytes once per rendition (sourceType
 * "Rendition", metadata.matchId, so the match_deleted purge nets them off).
 *
 * Idempotent: a job already succeeded, or a video no longer accepted, is
 * skipped; usage rows have a fixed source per rendition (NFR06). A failed
 * attempt is recorded on the row and rethrown (redacted) so pg-boss retries
 * it; the third failure marks the job and the match failed and pg-boss
 * dead-letters it (NFR30). Every state change is one "processing job" log
 * line (NFR31). Logs carry ids only.
 *
 * Disk: ffmpeg writes the whole ladder before the upload, so the worker needs
 * about twice the HLS size free (around 6 GB for 90 minutes).
 */

/** ffmpeg's own limit for one attempt. pg-boss expires the job later (TRANSCODE_JOB_OPTIONS). */
export const FFMPEG_TIMEOUT_MS = 4 * 3600 * 1000;
/** The signed URL ffmpeg reads from lasts the whole attempt. */
const SOURCE_URL_TTL_SEC = FFMPEG_TIMEOUT_MS / 1000;
const UPLOAD_CONCURRENCY = 4;
/** Kept from ffmpeg's stderr for the error message: the end says what went wrong. */
const STDERR_TAIL = 4000;

export type EncodeInput = {
  url: string;
  outDir: string;
  ladder: readonly Rendition[];
  hasAudio: boolean;
  onProgress: (ms: number) => void;
};

/** ffprobe and ffmpeg, injectable for tests. */
export type TranscodeRunner = {
  hasAudio: (url: string, videoId: string) => Promise<boolean>;
  encode: (input: EncodeInput) => Promise<void>;
};

/** pg-boss's attempt counters for this delivery. */
export type TranscodeMeta = { retryCount: number; retryLimit: number };

export type TranscodeOutcome = "succeeded" | "skipped";

/** Runs ffmpeg with no shell and a 4 h timeout, reporting progress from -progress pipe:1. */
export function runFfmpeg({ url, outDir, ladder, hasAudio, onProgress }: EncodeInput) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", ffmpegArgs(url, outDir, ladder, hasAudio), {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: FFMPEG_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    let stderr = "";
    let pending = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const lines = (pending + chunk).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const ms = progressMs(line);
        if (ms !== null) onProgress(ms);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve();
      else {
        const why = signal ? `killed by ${signal}` : `exit code ${code}`;
        reject(new Error(`ffmpeg failed (${why}): ${stderr.trim()}`));
      }
    });
  });
}

export const defaultRunner: TranscodeRunner = {
  async hasAudio(url, videoId) {
    const out = await runFfprobe(url, videoId);
    return !!out?.streams?.some((s) => s.codec_type === "audio");
  },
  encode: runFfmpeg,
};

type LocalFile = { path: string; key: string; file: string; bytes: number };

/**
 * The ladder's files in the temp dir, checked against FILE_PATTERN, with each
 * rendition's init segment renamed to init.mp4 and its playlist pointing at it.
 */
async function collectFiles(
  outDir: string,
  ladder: readonly Rendition[],
  keys: ReturnType<typeof hlsKeys>,
): Promise<{ byRendition: Map<RenditionName, LocalFile[]>; master: LocalFile }> {
  const byRendition = new Map<RenditionName, LocalFile[]>();
  for (const r of ladder) {
    const dir = join(outDir, r.name);
    const names = await readdir(dir);
    const init = names.find((n) => /^init(?:_\d+)?\.mp4$/.test(n));
    if (!init) throw new Error(`rendition ${r.name} has no init segment`);
    if (init !== INIT_SEGMENT) {
      await rename(join(dir, init), join(dir, INIT_SEGMENT));
      const playlist = join(dir, MEDIA_PLAYLIST);
      await writeFile(playlist, normaliseInitName(await readFile(playlist, "utf8"), init));
    }
    const files: LocalFile[] = [];
    for (const file of await readdir(dir)) {
      if (!FILE_PATTERN.test(file)) throw new Error(`unexpected file in rendition ${r.name}`);
      const path = join(dir, file);
      files.push({ path, file, key: keys.file(r.name, file), bytes: (await stat(path)).size });
    }
    if (!files.some((f) => f.file === MEDIA_PLAYLIST)) {
      throw new Error(`rendition ${r.name} has no playlist`);
    }
    byRendition.set(r.name, files);
  }
  const masterPath = join(outDir, MASTER_PLAYLIST);
  const master = {
    path: masterPath,
    file: MASTER_PLAYLIST,
    key: keys.master,
    bytes: (await stat(masterPath)).size,
  };
  return { byRendition, master };
}

async function put(f: LocalFile): Promise<void> {
  await s3Internal().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: f.key,
      Body: await readFile(f.path),
      ContentType: contentTypeFor(f.file),
    }),
  );
}

/** Uploads files UPLOAD_CONCURRENCY at a time. */
async function putAll(files: LocalFile[]): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < files.length) await put(files[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, lane));
}

/** Thrown inside the success transaction to roll it back when the video went away. */
class Gone extends Error {}

/** Handles one transcode delivery. The runner and the clock are injectable for tests. */
export async function handleTranscode(
  data: TranscodeJob,
  meta: TranscodeMeta,
  deps: { runner?: TranscodeRunner; now?: () => Date } = {},
): Promise<TranscodeOutcome> {
  const runner = deps.runner ?? defaultRunner;
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
      height: true,
      durationSec: true,
    },
  });
  if (!row || !video || row.videoId !== videoId) {
    // The match was deleted (its rows cascade); the purge removes any output.
    log.info({ organisationId, videoId, processingJobId }, "transcode skipped: job or video gone");
    return "skipped";
  }
  if (row.status === "succeeded" || row.status === "failed") {
    jobLog("skipped", row, { reason: `already_${row.status}` });
    return "skipped";
  }
  if (video.status !== "accepted" || video.deletedAt) {
    jobLog("skipped", row, { reason: "video_not_playable" });
    return "skipped";
  }

  const attempt = meta.retryCount + 1;
  const job = await markRunning(row, attempt, now());
  if (!job) {
    jobLog("skipped", row, { reason: "attempt_already_started", attemptDelivered: attempt });
    return "skipped";
  }
  jobLog("started", job);

  const keys = hlsKeys(organisationId, video.matchId, videoId);
  const ladder = ladderFor(video.height);
  const durationMs = (video.durationSec ?? 0) * 1000;
  let url: string | undefined;
  let outDir: string | undefined;
  try {
    url = await getSignedUrl(
      s3Internal(),
      new GetObjectCommand({ Bucket: bucket(), Key: video.blobPath }),
      { expiresIn: SOURCE_URL_TTL_SEC },
    );
    outDir = await mkdtemp(join(process.env.TRANSCODE_TMP_DIR || tmpdir(), "wl-transcode-"));
    const hasAudio = await runner.hasAudio(url, videoId);

    const encodeStart = Date.now();
    let decile = 0;
    await runner.encode({
      url,
      outDir,
      ladder,
      hasAudio,
      onProgress: (ms) => {
        if (durationMs <= 0) return;
        const d = Math.min(9, Math.floor((ms / durationMs) * 10));
        if (d > decile) {
          decile = d;
          jobLog("progress", job, { percent: d * 10, elapsedMs: Date.now() - encodeStart });
        }
      },
    });
    const encodeMs = Date.now() - encodeStart;

    const uploadStart = Date.now();
    const { byRendition, master } = await collectFiles(outDir, ladder, keys);
    const all = [...byRendition.values()].flat();
    // Segments and init first, then the media playlists, then the master: a
    // playlist never names a file that is not there yet.
    await putAll(all.filter((f) => f.file !== MEDIA_PLAYLIST));
    await putAll(all.filter((f) => f.file === MEDIA_PLAYLIST));
    await put(master);
    const uploadMs = Date.now() - uploadStart;

    const renditions = ladder.map((r, i) => {
      const files = byRendition.get(r.name)!;
      const bytes = files.reduce((n, f) => n + f.bytes, 0) + (i === 0 ? master.bytes : 0);
      return {
        name: r.name,
        height: r.height,
        bytes,
        segments: files.filter((f) => f.file.endsWith(".m4s")).length,
      };
    });
    const realtimeFactor = durationMs > 0 ? Number((encodeMs / durationMs).toFixed(4)) : null;
    const metadata = { renditions, hasAudio, encodeMs, uploadMs, realtimeFactor };

    const finishedAt = now();
    try {
      await rawDb.$transaction(async (tx) => {
        const { count } = await tx.video.updateMany({
          where: { id: videoId, organisationId, status: "accepted", deletedAt: null },
          data: { hlsManifestPath: keys.master },
        });
        if (count === 0) throw new Gone();
        if (!(await markSucceeded(tx, job, metadata, finishedAt))) throw new Gone();
        // C08: review-ready once the cv job has succeeded too.
        await moveToAwaitingReviewIfReady(tx, { organisationId, matchId: video.matchId, videoId });
        for (const r of renditions) {
          await recordUsage(
            {
              organisationId,
              metric: "storage_bytes",
              quantity: r.bytes,
              sourceType: "Rendition",
              sourceId: `${videoId}:${r.name}`,
              metadata: { matchId: video.matchId, videoId, rendition: r.name },
            },
            tx,
          );
        }
      });
    } catch (err) {
      if (!(err instanceof Gone)) throw err;
      // Deleted while encoding, or another delivery finished first. The HLS
      // files sit under the match prefix, so the purge removes them.
      jobLog("skipped", job, { reason: "video_gone_or_job_settled" });
      return "skipped";
    }
    jobLog(
      "succeeded",
      { ...job, status: "succeeded", finishedAt },
      {
        encodeMs,
        uploadMs,
        realtimeFactor,
        renditions: renditions.length,
      },
    );
    return "succeeded";
  } catch (err) {
    const error = redactJobError(err, { url, videoId });
    const final = isFinalAttempt(meta.retryCount, meta.retryLimit);
    const failedAt = now();
    await rawDb.$transaction(async (tx) => {
      await markAttemptFailed(job, { final, error }, tx, failedAt);
      // NFR30: the match shows Processing failed; C18 adds the admin retry.
      if (final) {
        await tx.match.updateMany({
          where: {
            id: video.matchId,
            organisationId,
            status: { in: fromStatusesFor("failed") },
          },
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
    // NFR30 (C08): platform admins hear of the final failure once.
    if (final) await alertPlatformAdmins(failedJob, "transcode failed 3 times");
    throw new Error(`transcode failed: ${error}`);
  } finally {
    if (outDir) await rm(outDir, { recursive: true, force: true });
  }
}
