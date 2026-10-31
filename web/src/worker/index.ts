/**
 * Worker entry point: a long-running process that consumes pg-boss queues.
 * Same codebase as the web app, separate container. C06 adds probe and
 * retention, C07 transcode, C08 cv and cv-watchdog, C09 clips, C10 review-sweep.
 *
 * WORKER_QUEUES (comma-separated) picks the queues this process consumes;
 * unset, it consumes all of them. Compose runs two: the transcode worker
 * (probe, transcode, clips, review-sweep, retention, consent-withdrawn) and the cv
 * dispatcher (cv, cv-watchdog), which alone mounts the Docker socket.
 */
import type {
  ClipsJob,
  ConsentWithdrawnJob,
  CvJob,
  ProbeJob,
  RetentionJob,
  TranscodeJob,
} from "../server/queue";

export {};

// Set before the logger is imported, so log lines carry the service name.
process.env.WIDELINE_SERVICE ??= "transcode-worker";

const { log } = await import("../server/log");
const { getBoss, QUEUES, DEAD_LETTER_QUEUE } = await import("../server/queue");

const { handleProbe } = await import("./probe");
const { handleRetention } = await import("./retention");
const { handleTranscode } = await import("./transcode");
const { handleCvJob } = await import("./cv");
const { handleCvWatchdog } = await import("./cv-watchdog");
const { handleClips } = await import("./clips");
const { handleReviewSweep } = await import("./review-sweep");
const { purgeUnattributablePlayerTracks } = await import("../server/cv/withdrawal");

const boss = await getBoss();

const wanted = (process.env.WORKER_QUEUES ?? "")
  .split(",")
  .map((q) => q.trim())
  .filter(Boolean);
const consumes = (queue: string) => wanted.length === 0 || wanted.includes(queue);
const started: string[] = [];

// C06 (MATCH03, MATCH04): ffprobe the uploaded footage and apply the footage
// rules. A throw fails the job: pg-boss retries it, then dead-letters it (NFR30).
if (consumes(QUEUES.probe)) {
  await boss.work<ProbeJob>(QUEUES.probe, async (jobs) => {
    for (const job of jobs) {
      const outcome = await handleProbe(job.data);
      log.info({ jobId: job.id, videoId: job.data.videoId, outcome }, "probe job done");
    }
  });
  started.push(QUEUES.probe);
}

// C07 (MATCH06): the HLS ladder, one job at a time per worker (ffmpeg uses
// every core). A throw is recorded on the ProcessingJob and fails the job:
// pg-boss retries it, then dead-letters it after 3 attempts (NFR30).
const transcodeOptions = { includeMetadata: true, batchSize: 1, localConcurrency: 1 } as const;
if (consumes(QUEUES.transcode)) {
  await boss.work<TranscodeJob, unknown, typeof transcodeOptions>(
    QUEUES.transcode,
    transcodeOptions,
    async (jobs) => {
      for (const job of jobs) {
        await handleTranscode(job.data, { retryCount: job.retryCount, retryLimit: job.retryLimit });
      }
    },
  );
  started.push(QUEUES.transcode);
}

// C09 (CV11): cut one clip per event after the CV ingest, one job at a time per
// worker (each job runs CLIPS_CONCURRENCY ffmpeg processes). A throw is
// recorded and fails the job: pg-boss retries it, then dead-letters it (NFR30).
const clipsOptions = { includeMetadata: true, batchSize: 1, localConcurrency: 1 } as const;
if (consumes(QUEUES.clips)) {
  await boss.work<ClipsJob, unknown, typeof clipsOptions>(
    QUEUES.clips,
    clipsOptions,
    async (jobs) => {
      for (const job of jobs) {
        await handleClips(job.data, { retryCount: job.retryCount, retryLimit: job.retryLimit });
      }
    },
  );
  started.push(QUEUES.clips);
}

// C08 (CV01, CV10): one GPU instance per CV attempt. The handler holds the job
// while the instance runs, polling its row, so each dispatcher runs
// CV_CONCURRENCY jobs at once (default 2). A throw is recorded and fails the
// job: pg-boss retries it, then dead-letters it after 3 attempts (NFR30).
const cvOptions = {
  includeMetadata: true,
  batchSize: 1,
  localConcurrency: Number(process.env.CV_CONCURRENCY) || 2,
} as const;
if (consumes(QUEUES.cv)) {
  await boss.work<CvJob, unknown, typeof cvOptions>(QUEUES.cv, cvOptions, async (jobs) => {
    for (const job of jobs) {
      await handleCvJob(job.data, { retryCount: job.retryCount, retryLimit: job.retryLimit });
    }
  });
  started.push(QUEUES.cv);
}

// C08 (NFR07): every minute, destroy idle or outlived GPU instances and repair
// lost CV jobs.
if (consumes(QUEUES.cvWatchdog)) {
  await boss.schedule(QUEUES.cvWatchdog, "* * * * *");
  await boss.work(QUEUES.cvWatchdog, async () => {
    await handleCvWatchdog({ boss });
  });
  started.push(QUEUES.cvWatchdog);
}

// C10 (REVIEW01, REVIEW13): every minute, expire review claims past their 48
// hours, release suspended or conflicted scouts' claims, and alert platform
// admins about unreviewed footage near deletion.
if (consumes(QUEUES.reviewSweep)) {
  await boss.schedule(QUEUES.reviewSweep, "* * * * *");
  await boss.work(QUEUES.reviewSweep, async () => {
    await handleReviewSweep();
  });
  started.push(QUEUES.reviewSweep);
}

// C06 (MATCH08, NFR32): purge a deleted match's storage. C17 adds its sweep here.
if (consumes(QUEUES.retention)) {
  await boss.work<RetentionJob>(QUEUES.retention, async (jobs) => {
    for (const job of jobs) await handleRetention(job.data);
  });
  started.push(QUEUES.retention);
}

// C05 (NFR11): a consent change took visibility away. Live queries already
// hide the player (consentVisibleTo). C08 purges the player's tracks and
// unlinks their events here. The events' clips stay as team-level footage
// (QUESTIONS.md Q-047), not purged. C12 (stats caches) and C13 (profiles) add
// their own derived artefacts within 24 hours.
if (consumes(QUEUES.consentWithdrawn)) {
  await boss.work<ConsentWithdrawnJob>(QUEUES.consentWithdrawn, async (jobs) => {
    for (const job of jobs) {
      const { organisationId, playerId, consentId } = job.data;
      const purged = await purgeUnattributablePlayerTracks(organisationId, playerId);
      log.info(
        { jobId: job.id, organisationId, playerId, consentId, ...purged },
        "consent withdrawn: derived data purged",
      );
    }
  });
  started.push(QUEUES.consentWithdrawn);
}

log.info({ queues: started, deadLetter: DEAD_LETTER_QUEUE }, "worker ready");

async function shutdown(signal: string) {
  log.info({ signal }, "worker stopping");
  await boss.stop({ graceful: true, timeout: 30_000 });
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
