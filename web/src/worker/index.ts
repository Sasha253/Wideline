/**
 * Transcode worker entry point: a long-running process that consumes pg-boss
 * queues (probe, transcode, clips) and dispatches CV jobs. Same codebase as the
 * web app, separate container. C06 adds probe and retention, C07 transcode; CV
 * and clips arrive in C08 and C09.
 */
import type { ConsentWithdrawnJob, ProbeJob, RetentionJob, TranscodeJob } from "../server/queue";

export {};

// Set before the logger is imported, so log lines carry the service name.
process.env.WIDELINE_SERVICE ??= "transcode-worker";

const { log } = await import("../server/log");
const { getBoss, QUEUES, DEAD_LETTER_QUEUE } = await import("../server/queue");

const { handleProbe } = await import("./probe");
const { handleRetention } = await import("./retention");
const { handleTranscode } = await import("./transcode");

const boss = await getBoss();

// C06 (MATCH03, MATCH04): ffprobe the uploaded footage and apply the footage
// rules. A throw fails the job: pg-boss retries it, then dead-letters it (NFR30).
await boss.work<ProbeJob>(QUEUES.probe, async (jobs) => {
  for (const job of jobs) {
    const outcome = await handleProbe(job.data);
    log.info({ jobId: job.id, videoId: job.data.videoId, outcome }, "probe job done");
  }
});

// C07 (MATCH06): the HLS ladder, one job at a time per worker (ffmpeg uses
// every core). A throw is recorded on the ProcessingJob and fails the job:
// pg-boss retries it, then dead-letters it after 3 attempts (NFR30).
const transcodeOptions = { includeMetadata: true, batchSize: 1, localConcurrency: 1 } as const;
await boss.work<TranscodeJob, unknown, typeof transcodeOptions>(
  QUEUES.transcode,
  transcodeOptions,
  async (jobs) => {
    for (const job of jobs) {
      await handleTranscode(job.data, { retryCount: job.retryCount, retryLimit: job.retryLimit });
    }
  },
);

// C06 (MATCH08, NFR32): purge a deleted match's storage. C17 adds its sweep here.
await boss.work<RetentionJob>(QUEUES.retention, async (jobs) => {
  for (const job of jobs) await handleRetention(job.data);
});

// C05 (NFR11): a consent change took visibility away. Live queries already
// hide the player (consentVisibleTo). This stub only logs ids: C12 (stats
// caches), C13 (clips and profiles) and C17 (retention) purge their derived
// artefacts here within 24 hours, once they exist.
await boss.work<ConsentWithdrawnJob>(QUEUES.consentWithdrawn, async (jobs) => {
  for (const job of jobs) {
    const { organisationId, playerId, consentId } = job.data;
    log.info(
      { jobId: job.id, organisationId, playerId, consentId },
      "consent withdrawn: nothing derived to purge yet",
    );
  }
});

log.info({ queues: [...Object.values(QUEUES), DEAD_LETTER_QUEUE] }, "worker ready");

async function shutdown(signal: string) {
  log.info({ signal }, "worker stopping");
  await boss.stop({ graceful: true, timeout: 30_000 });
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
