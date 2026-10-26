import { randomUUID } from "node:crypto";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db/raw";
import {
  DEAD_LETTER_QUEUE,
  getBoss,
  MAX_ATTEMPTS,
  queuePolicy,
  QUEUES,
  TRANSCODE_JOB_OPTIONS,
  type TranscodeJob,
} from "@/server/queue";
import { handleTranscode, type TranscodeRunner } from "@/worker/transcode";
import { fixtures } from "./helpers/fixtures";
import { jobsFor, match, setupClub } from "./helpers/matches";
import { acceptedVideo } from "./helpers/transcode";

// C07 acceptance (NFR30): a failed transcode runs 3 times and then lands in
// the dead-letter queue. Part one runs the real handler under real pg-boss on
// a throwaway queue with the transcode queue's policy and no retry delay,
// with an encoder that always fails: after 3 attempts the job is in
// `dead-letter`, the ProcessingJob is failed with attempts 3 and a redacted
// error, and the match moved Processing to Failed. Part two checks the real
// `transcode` queue carries that policy. Needs only Postgres.

const f = fixtures();
const queue = `transcode-retry-test-${randomUUID().slice(0, 8)}`;
let boss: PgBoss;
let club: Awaited<ReturnType<typeof setupClub>>;
const attempts: number[] = [];
const deadLettered: string[] = [];

const failing: TranscodeRunner = {
  hasAudio: async () => true,
  encode: async ({ url }) => {
    throw new Error(`ffmpeg failed (exit code 1): ${url}: Server returned 500`);
  },
};

beforeAll(async () => {
  boss = await getBoss();
  club = await setupClub(f, "Retry FC");
  await boss.createQueue(queue, queuePolicy(0));
  const options = { includeMetadata: true, batchSize: 1, pollingIntervalSeconds: 0.5 } as const;
  await boss.work<TranscodeJob, unknown, typeof options>(queue, options, async (jobs) => {
    for (const job of jobs) {
      attempts.push(job.retryCount + 1);
      await handleTranscode(
        job.data,
        { retryCount: job.retryCount, retryLimit: job.retryLimit },
        { runner: failing },
      );
    }
  });
});

afterAll(async () => {
  await boss.offWork(queue);
  await boss.deleteQueue(queue);
  // The dead-letter copies have no consumer: remove this file's.
  if (deadLettered.length) {
    await rawDb.$executeRawUnsafe(
      `DELETE FROM pgboss.job WHERE name = $1 AND data->>'processingJobId' = ANY($2::text[])`,
      DEAD_LETTER_QUEUE,
      deadLettered,
    );
  }
  await f.cleanup();
  await boss.stop({ graceful: false });
});

async function until(check: () => Promise<boolean>, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("timed out");
}

describe("transcode retries", { timeout: 90_000 }, () => {
  it("runs 3 times, then dead-letters the job and fails the job row and the match", async () => {
    const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
    const { video, job } = await acceptedVideo(club.org.id, matchId);
    const payload: TranscodeJob = {
      organisationId: club.org.id,
      videoId: video.id,
      processingJobId: job.id,
    };
    await boss.send(queue, payload, { id: job.bossJobId, ...TRANSCODE_JOB_OPTIONS });
    deadLettered.push(job.id);

    await until(async () => (await jobsFor(DEAD_LETTER_QUEUE, "processingJobId", job.id)) === 1);
    expect(attempts).toEqual([1, 2, 3]);

    const original = await boss.getJobById(queue, job.bossJobId);
    expect(original).toMatchObject({ state: "failed", retryCount: MAX_ATTEMPTS - 1 });

    const row = await rawDb.processingJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ status: "failed", attempts: 3, maxAttempts: 3 });
    expect(row.finishedAt).not.toBeNull();
    expect(row.errorMessage).toMatch(
      /^ffmpeg failed \(exit code 1\): video .+: Server returned 500$/,
    );
    expect(row.errorMessage).not.toMatch(/X-Amz|Signature/);
    expect((await rawDb.match.findUniqueOrThrow({ where: { id: matchId } })).status).toBe("failed");
  });

  it("gives the real transcode queue 3 attempts and the dead-letter queue", async () => {
    const q = await boss.getQueue(QUEUES.transcode);
    expect(q).toMatchObject({ retryLimit: MAX_ATTEMPTS - 1, deadLetter: DEAD_LETTER_QUEUE });
    expect(MAX_ATTEMPTS).toBe(3);
  });
});
