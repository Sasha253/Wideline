/**
 * Transcode worker entry point: a long-running process that consumes pg-boss
 * queues (probe, transcode, clips) and dispatches CV jobs. Same codebase as the
 * web app, separate container. Handlers arrive in Phase 2 onward.
 */
export {};

// Set before the logger is imported, so log lines carry the service name.
process.env.WIDELINE_SERVICE ??= "transcode-worker";

const { log } = await import("../server/log");
const { getBoss, QUEUES, DEAD_LETTER_QUEUE } = await import("../server/queue");

const boss = await getBoss();
log.info({ queues: [...Object.values(QUEUES), DEAD_LETTER_QUEUE] }, "worker ready");

async function shutdown(signal: string) {
  log.info({ signal }, "worker stopping");
  await boss.stop({ graceful: true, timeout: 30_000 });
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
