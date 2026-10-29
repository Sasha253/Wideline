import { PgBoss } from "pg-boss";
import { log } from "./log";

/**
 * pg-boss on the app's own Postgres (no Redis). Queue names and retry policy
 * live here so the web app (producer) and the worker (consumer) agree.
 *
 * Retry policy: 3 attempts in total, then the job moves to the dead-letter
 * queue (CV-10, NFR-30). The PRD says both "retry up to 3 times" (CV-10) and
 * "fail 3 times" (NFR-30); we follow NFR-30.
 */
export const QUEUES = {
  probe: "probe",
  transcode: "transcode",
  cv: "cv",
  // C08 (NFR07): every minute, destroys GPU instances that are idle or have
  // outlived their job, and repairs lost CV jobs (src/worker/cv-watchdog.ts).
  cvWatchdog: "cv-watchdog",
  clips: "clips",
  // C05 (NFR11): a consent change took visibility away. Payload
  // ConsentWithdrawnJob. The handler is a stub until C12, C13 and C17 have
  // derived artefacts to purge (src/worker/index.ts).
  consentWithdrawn: "consent-withdrawn",
  // C06: deletes object storage after a match is deleted (RetentionJob). C17
  // adds its daily raw-footage and clip sweep to the same queue, so one
  // process deletes footage (NFR32).
  retention: "retention",
} as const;

/**
 * The probe payload (C06): ids only. The handler re-reads the Video row. Sent
 * with the video id as the pg-boss job id, so sending it again is a no-op.
 */
export type ProbeJob = {
  organisationId: string;
  videoId: string;
};

/**
 * The retention payload. Ids and object keys only, never names. match_deleted
 * (C06): the match rows are gone, so everything the worker needs travels here.
 * It aborts the open multipart uploads listed, then purges everything under
 * `prefix`, but not before `rawExpiresAt` (Q-025, NFR32: raw footage is kept 7
 * days after upload, even when its match is deleted). `rawExpiresAt` is the
 * latest raw-footage expiry of the match's videos as an ISO string, or null
 * when no upload ever completed. Jobs sent before these fields existed have
 * neither: the worker derives the prefix and treats the expiry as null.
 */
export type RetentionJob = {
  kind: "match_deleted";
  organisationId: string;
  matchId: string;
  uploads: { key: string; uploadId: string }[];
  prefix?: string;
  rawExpiresAt?: string | null;
};

/**
 * The transcode payload (C07): ids only. The handler re-reads the
 * ProcessingJob and the Video. Sent with ProcessingJob.bossJobId as the
 * pg-boss job id, so sending it again (a probe retry repairing a failed
 * enqueue) is a no-op.
 */
export type TranscodeJob = {
  organisationId: string;
  videoId: string;
  processingJobId: string;
};

/**
 * Send options for transcode jobs. pg-boss expires an active job after 15
 * minutes by default; a 90-minute match takes longer than that to encode, so
 * the expiry sits above ffmpeg's own 4 h timeout (src/worker/transcode.ts).
 */
export const TRANSCODE_JOB_OPTIONS = { expireInSeconds: 5 * 3600 } as const;

/**
 * The CV payload (C08): ids only, as TranscodeJob. Sent with
 * ProcessingJob.bossJobId as the pg-boss id, so a resend is a no-op. The
 * handler holds the job while its GPU instance runs (src/worker/cv.ts).
 */
export type CvJob = {
  organisationId: string;
  videoId: string;
  processingJobId: string;
};

/**
 * Send options for CV jobs: pg-boss expires an active job only after the
 * longest attempt the dispatcher allows (CV_MAX_JOB_SECONDS, 4 h by default)
 * plus 30 minutes, so the dispatcher's own deadline fires first.
 */
export function cvJobOptions(): { expireInSeconds: number } {
  const max = Number(process.env.CV_MAX_JOB_SECONDS) || 4 * 3600;
  return { expireInSeconds: max + 1800 };
}

/** The consent-withdrawn payload: ids only, never names (children's data). */
export type ConsentWithdrawnJob = {
  organisationId: string;
  playerId: string;
  consentId: string;
};

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const DEAD_LETTER_QUEUE = "dead-letter";
export const MAX_ATTEMPTS = 3;

const globalForBoss = globalThis as unknown as { boss?: Promise<PgBoss> };

async function start(): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const boss = new PgBoss({ connectionString, schema: "pgboss" });
  boss.on("error", (err) => log.error({ err }, "pg-boss error"));
  await boss.start();
  await ensureQueues(boss);
  return boss;
}

/**
 * Every queue's retry policy: MAX_ATTEMPTS in total, 30 s apart with backoff,
 * then the dead-letter queue. Exported so a test can build a throwaway queue
 * with the same policy and no delay.
 */
export function queuePolicy(retryDelay = 30) {
  return {
    retryLimit: MAX_ATTEMPTS - 1,
    retryDelay,
    retryBackoff: retryDelay > 0,
    deadLetter: DEAD_LETTER_QUEUE,
  };
}

export async function ensureQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(DEAD_LETTER_QUEUE);
  for (const name of Object.values(QUEUES)) {
    await boss.createQueue(name, queuePolicy());
  }
}

/** One started pg-boss instance per process. */
export function getBoss(): Promise<PgBoss> {
  globalForBoss.boss ??= start();
  return globalForBoss.boss;
}
