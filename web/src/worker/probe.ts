import { execFile } from "node:child_process";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { evaluateFootage, type FootageValidation, type ProbeSummary } from "../lib/footage-rules";
import { rawDb } from "../server/db/raw";
import { log } from "../server/log";
import { isUnreadableFile, summariseProbe, type FfprobeOutput } from "../server/matches/probe";
import type { ProbeJob } from "../server/queue";
import { bucket, s3Internal } from "../server/storage";
import { recordUsage } from "../server/usage/meter";

/**
 * The probe job (MATCH03, MATCH04; NFR30): ffprobe the uploaded file, apply the
 * footage rules, and move the video and its match on. Accepted footage moves
 * the match Uploading to Processing; rejected footage sends it back to Draft so
 * the club can upload again, and the rejected file stays until rawExpiresAt
 * for the retention job (NFR32).
 *
 * Idempotent: only a video still in probing is handled, and the status change,
 * the metadata and the video_seconds usage row commit in one transaction, so a
 * retried job changes nothing twice (NFR06). A file ffprobe cannot read is a
 * rejection; anything else that fails throws, so pg-boss retries it and then
 * dead-letters it after 3 attempts. Logs carry ids only.
 */

const FFPROBE_TIMEOUT_MS = 120_000;
/** The signed URL ffprobe reads from; it seeks, so it needs a few minutes at most. */
const PROBE_URL_TTL_SEC = 15 * 60;

/** ffprobe output as JSON, or null when the file cannot be read as video at all. */
export type ProbeRunner = (url: string) => Promise<FfprobeOutput | null>;

/** Runs ffprobe with no shell, a 120 s timeout and JSON output. */
export const runFfprobe: ProbeRunner = (url) =>
  new Promise((resolve, reject) => {
    execFile(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", url],
      { timeout: FFPROBE_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          if (!(err as { killed?: boolean }).killed && isUnreadableFile(String(stderr))) {
            resolve(null);
            return;
          }
          reject(new Error(`ffprobe failed: ${String(stderr).slice(0, 300)}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as FfprobeOutput);
        } catch {
          resolve(null);
        }
      },
    );
  });

/**
 * C07 hook: accepted footage goes on to transcoding. C06 only logs; C07
 * enqueues the transcode job here.
 */
export async function onFootageAccepted(job: ProbeJob & { matchId: string }): Promise<void> {
  log.info(job, "footage accepted: transcode is C07");
}

export type ProbeOutcome = "accepted" | "rejected" | "skipped";

/** Handles one probe job. The runner is injectable for tests. */
export async function handleProbe(
  job: ProbeJob,
  runner: ProbeRunner = runFfprobe,
  now = new Date(),
): Promise<ProbeOutcome> {
  const { organisationId, videoId } = job;
  const video = await rawDb.video.findFirst({
    where: { id: videoId, organisationId },
    select: {
      id: true,
      status: true,
      matchId: true,
      blobPath: true,
      match: { select: { halfLengthMinutes: true } },
    },
  });
  if (!video || video.status !== "probing") {
    log.info({ organisationId, videoId }, "probe skipped: video not waiting for a probe");
    return "skipped";
  }

  const url = await getSignedUrl(
    s3Internal(),
    new GetObjectCommand({ Bucket: bucket(), Key: video.blobPath }),
    { expiresIn: PROBE_URL_TTL_SEC },
  );
  const output = await runner(url);
  const summary: ProbeSummary | null = output ? summariseProbe(output) : null;
  const validation: FootageValidation = evaluateFootage(summary, {
    halfLengthMinutes: video.match.halfLengthMinutes,
  });
  const accepted = validation.verdict !== "rejected";

  const changed = await rawDb.$transaction(async (tx) => {
    const { count } = await tx.video.updateMany({
      where: { id: videoId, organisationId, status: "probing" },
      data: {
        status: accepted ? "accepted" : "rejected",
        probedAt: now,
        durationSec: summary?.durationSec ?? null,
        width: summary?.width ?? null,
        height: summary?.height ?? null,
        fps: summary?.fps ?? null,
        codec: summary?.codec ?? null,
        rotation: summary?.rotation ?? null,
        validation,
      },
    });
    if (count === 0) return false;
    await tx.match.updateMany({
      where: { id: video.matchId, organisationId, status: "uploading" },
      data: { status: accepted ? "processing" : "draft" },
    });
    if (accepted && summary?.durationSec) {
      await recordUsage(
        {
          organisationId,
          metric: "video_seconds",
          quantity: Math.round(summary.durationSec),
          sourceType: "Video",
          sourceId: videoId,
          metadata: { matchId: video.matchId },
        },
        tx,
      );
    }
    return true;
  });
  if (!changed) return "skipped";

  log.info(
    {
      organisationId,
      videoId,
      matchId: video.matchId,
      verdict: validation.verdict,
      issues: validation.issues.map((i) => i.code),
    },
    "footage probed",
  );
  if (accepted) await onFootageAccepted({ organisationId, videoId, matchId: video.matchId });
  return accepted ? "accepted" : "rejected";
}
