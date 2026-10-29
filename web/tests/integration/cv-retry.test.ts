import { randomUUID } from "node:crypto";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleCvCallback } from "@/server/cv/callback";
import { alertPlatformAdmins } from "@/server/processing/alerts";
import { rawDb } from "@/server/db/raw";
import {
  cvJobOptions,
  DEAD_LETTER_QUEUE,
  getBoss,
  MAX_ATTEMPTS,
  queuePolicy,
  QUEUES,
  type CvJob,
} from "@/server/queue";
import { handleCvJob } from "@/worker/cv";
import { fixtures } from "./helpers/fixtures";
import {
  alertsFor,
  cvJob,
  FakeGpuProvider,
  platformAdmin,
  platformAdminEmails,
} from "./helpers/cv";
import { jobsFor, match, setupClub } from "./helpers/matches";
import { acceptedVideo } from "./helpers/transcode";

// C08 acceptance (CV10, NFR30): a CV job whose result breaks the contract runs
// 3 times and then lands in the dead-letter queue. The real handler under real
// pg-boss, on a throwaway queue with the cv queue's policy and no retry delay,
// with a fake GPU provider whose worker always reports success and a result
// missing a required field. After 3 attempts the job and the match are failed
// with a redacted error, platform admins are emailed once, and each attempt's
// instance was destroyed and costed. Needs only Postgres.

const deliverMail = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/server/mail-transport", () => ({ deliverMail }));

const f = fixtures();
const queue = `cv-retry-test-${randomUUID().slice(0, 8)}`;
let boss: PgBoss;
let club: Awaited<ReturnType<typeof setupClub>>;
const attempts: number[] = [];
const deadLettered: string[] = [];
const provider = new FakeGpuProvider();
let admin: { email: string };

beforeAll(async () => {
  boss = await getBoss();
  club = await setupClub(f, "CV Retry FC");
  admin = await platformAdmin(f);
  await boss.createQueue(queue, queuePolicy(0));
  const options = { includeMetadata: true, batchSize: 1, pollingIntervalSeconds: 0.5 } as const;
  await boss.work<CvJob, unknown, typeof options>(queue, options, async (jobs) => {
    for (const job of jobs) {
      attempts.push(job.retryCount + 1);
      await handleCvJob(
        job.data,
        { retryCount: job.retryCount, retryLimit: job.retryLimit },
        {
          provider,
          pollMs: 1,
          // The worker reports success on the first poll.
          sleep: async () => {
            const spec = JSON.parse(provider.started.at(-1)!.env.WIDELINE_JOB!);
            await handleCvCallback(
              spec.jobId,
              `Bearer ${spec.callbackToken}`,
              JSON.stringify({
                instanceId: spec.instanceId,
                kind: "succeeded",
                resultSha256: "c".repeat(64),
              }),
            );
          },
          // A result with no warnings: it breaks the contract every time.
          loadResult: async () => ({
            json: { schemaVersion: "1.0", jobId: job.data.processingJobId },
            bytes: 10,
            sha256: "c".repeat(64),
          }),
        },
      );
    }
  });
});

afterAll(async () => {
  await boss.offWork(queue);
  await boss.deleteQueue(queue);
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

describe("cv retries", { timeout: 90_000 }, () => {
  it("runs 3 times, then dead-letters the job, fails the job and the match, and alerts once", async () => {
    const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
    const { video } = await acceptedVideo(club.org.id, matchId);
    const job = await cvJob(club.org.id, matchId, video.id);
    const payload: CvJob = {
      organisationId: club.org.id,
      videoId: video.id,
      processingJobId: job.id,
    };
    await boss.send(queue, payload, { id: job.bossJobId, ...cvJobOptions() });
    deadLettered.push(job.id);

    await until(async () => (await jobsFor(DEAD_LETTER_QUEUE, "processingJobId", job.id)) === 1);
    expect(attempts).toEqual([1, 2, 3]);
    expect(await boss.getJobById(queue, job.bossJobId)).toMatchObject({
      state: "failed",
      retryCount: MAX_ATTEMPTS - 1,
    });

    const row = await rawDb.processingJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ status: "failed", attempts: 3, maxAttempts: 3 });
    expect(row.errorMessage).toMatch(/^CV result invalid: \/ missing /);
    expect(row.alertedAt).not.toBeNull();
    expect((await rawDb.match.findUniqueOrThrow({ where: { id: matchId } })).status).toBe("failed");

    const instances = await rawDb.gpuInstance.findMany({
      where: { processingJobId: job.id },
      orderBy: { attempt: "asc" },
    });
    expect(instances.map((i) => [i.attempt, i.status])).toEqual([
      [1, "destroyed"],
      [2, "destroyed"],
      [3, "destroyed"],
    ]);
    expect(
      await rawDb.usageEvent.count({
        where: { metric: "gpu_cost_cents", sourceId: { in: instances.map((i) => i.id) } },
      }),
    ).toBe(3);
    expect(row.costCents).toBe(instances.reduce((n, i) => n + (i.costCents ?? 0), 0));

    // NFR30: one email per platform admin, ids only, and never a second time.
    const alerts = alertsFor(deliverMail.mock.calls, job.id);
    const admins = await platformAdminEmails();
    expect(admins).toContain(admin.email);
    expect(alerts.map((a) => a.to).sort()).toEqual(admins);
    for (const a of alerts) {
      expect(a.text).toContain(job.id);
      expect(a.text).not.toMatch(/X-Amz|Signature/);
    }
    expect(await alertPlatformAdmins(row, "again")).toBe(false);
    expect(alertsFor(deliverMail.mock.calls, job.id)).toHaveLength(alerts.length);
  });

  it("gives the real cv queue 3 attempts and the dead-letter queue", async () => {
    const q = await boss.getQueue(QUEUES.cv);
    expect(q).toMatchObject({ retryLimit: MAX_ATTEMPTS - 1, deadLetter: DEAD_LETTER_QUEUE });
  });
});
