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

/** The probe payload (C06): ids only. The handler re-reads the Video row. */
export type ProbeJob = {
  organisationId: string;
  videoId: string;
};

/**
 * The retention payload. Ids and object keys only, never names. match_deleted
 * (C06): the match rows are gone; purge everything under its storage prefix
 * and abort the open multipart uploads listed.
 */
export type RetentionJob = {
  kind: "match_deleted";
  organisationId: string;
  matchId: string;
  uploads: { key: string; uploadId: string }[];
};

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

export async function ensureQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(DEAD_LETTER_QUEUE);
  for (const name of Object.values(QUEUES)) {
    await boss.createQueue(name, {
      retryLimit: MAX_ATTEMPTS - 1,
      retryDelay: 30,
      retryBackoff: true,
      deadLetter: DEAD_LETTER_QUEUE,
    });
  }
}

/** One started pg-boss instance per process. */
export function getBoss(): Promise<PgBoss> {
  globalForBoss.boss ??= start();
  return globalForBoss.boss;
}
