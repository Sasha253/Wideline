/**
 * Transcode worker entry point: a long-running process that consumes pg-boss
 * queues (probe, transcode, clips) and dispatches CV jobs. Same codebase as the
 * web app, separate container. Handlers arrive in Phase 2 onward.
 */
import type { ConsentWithdrawnJob } from "../server/queue";

export {};

// Set before the logger is imported, so log lines carry the service name.
process.env.WIDELINE_SERVICE ??= "transcode-worker";

const { log } = await import("../server/log");
const { getBoss, QUEUES, DEAD_LETTER_QUEUE } = await import("../server/queue");

const boss = await getBoss();

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
