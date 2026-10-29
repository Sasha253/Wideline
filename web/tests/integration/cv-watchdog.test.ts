import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { markInstanceStarted, requestInstance } from "@/server/cv/instances";
import { rawDb } from "@/server/db/raw";
import { createClipsJob, markRunning } from "@/server/processing/jobs";
import { handleCvWatchdog, type WatchdogDeps } from "@/worker/cv-watchdog";
import { fixtures } from "./helpers/fixtures";
import {
  alertsFor,
  cvJob,
  FakeGpuProvider,
  platformAdmin,
  platformAdminEmails,
} from "./helpers/cv";
import { match, setupClub } from "./helpers/matches";
import { acceptedVideo } from "./helpers/transcode";

// C08 (NFR07, NFR30): the watchdog handler on real rows, with a fake clock
// and provider. An instance silent for 10 minutes is destroyed and costed; a
// cv job queued 5 minutes without starting is sent again; a running job whose
// pg-boss job failed for good (a crashed dispatcher) is failed with its match,
// and platform admins are told once; an alert whose email failed is sent again.
// C09: a clips job queued 10 minutes without starting is sent again, and a
// succeeded cv job with no clips job (ingested before C09) gets one.

const deliverMail = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/server/mail-transport", () => ({ deliverMail }));

const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;
let admin: { email: string };
const MIN = 60_000;

beforeAll(async () => {
  club = await setupClub(f, "Watchdog FC");
  admin = await platformAdmin(f);
});

afterAll(async () => {
  await f.cleanup();
});

async function setup() {
  const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
  const { video } = await acceptedVideo(club.org.id, matchId);
  return { matchId, job: await cvJob(club.org.id, matchId, video.id) };
}

describe("handleCvWatchdog", () => {
  it("destroys an idle instance and records its cost", async () => {
    const { job } = await setup();
    const running = (await markRunning(job, 1))!;
    const provider = new FakeGpuProvider();
    const t0 = new Date();
    const instance = await markInstanceStarted(
      await requestInstance(running, 1, provider, t0),
      "fake-x",
      t0,
    );
    provider.states.set("fake-x", "running");

    const later = new Date(t0.getTime() + 10 * MIN);
    const summary = await handleCvWatchdog({
      provider,
      now: () => later,
      resend: vi.fn(),
      sendClips: vi.fn(),
    });
    expect(summary.destroyed).toBeGreaterThanOrEqual(1);
    const row = await rawDb.gpuInstance.findUniqueOrThrow({ where: { id: instance.id } });
    expect(row).toMatchObject({
      status: "destroyed",
      destroyReason: "idle",
      billedSeconds: 600,
      costCents: 600,
    });
    expect(provider.destroyed).toContain("fake-x");
  });

  it("sends a cv job again after 5 minutes queued without starting", async () => {
    const { job } = await setup();
    await rawDb.processingJob.update({
      where: { id: job.id },
      data: { queuedAt: new Date(Date.now() - 6 * MIN) },
    });
    const resend = vi.fn(async () => {});
    await handleCvWatchdog({ provider: new FakeGpuProvider(), resend, sendClips: vi.fn() });
    expect(resend.mock.calls.map((c) => (c as unknown as [{ id: string }])[0].id)).toContain(
      job.id,
    );
  });

  it("fails a job pg-boss gave up on, with its match, and alerts once", async () => {
    const { matchId, job } = await setup();
    await markRunning(job, 1, new Date(Date.now() - 10 * MIN));
    const boss = { getJobById: vi.fn(async () => ({ state: "failed" })) };
    const run = () =>
      handleCvWatchdog({
        provider: new FakeGpuProvider(),
        resend: vi.fn(),
        sendClips: vi.fn(),
        boss: boss as unknown as NonNullable<WatchdogDeps["boss"]>,
      });
    expect((await run()).reconciled).toBeGreaterThanOrEqual(1);
    const row = await rawDb.processingJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ status: "failed" });
    expect(row.errorMessage).toMatch(/worker lost/);
    expect(row.alertedAt).not.toBeNull();
    expect((await rawDb.match.findUniqueOrThrow({ where: { id: matchId } })).status).toBe("failed");
    // NFR30: one email per platform admin, ids only; a second run sends none.
    const alerts = alertsFor(deliverMail.mock.calls, job.id);
    const admins = await platformAdminEmails();
    expect(admins).toContain(admin.email);
    expect(alerts.map((a) => a.to).sort()).toEqual(admins);
    for (const a of alerts) {
      expect(a.text).toContain(job.id);
      expect(a.text).not.toMatch(/X-Amz|Signature/);
    }
    await run();
    expect(alertsFor(deliverMail.mock.calls, job.id)).toHaveLength(alerts.length);
  });

  it("sends a clips job again after 10 minutes queued without starting (C09)", async () => {
    const { matchId, job } = await setup();
    const { job: clips } = await rawDb.$transaction((tx) =>
      createClipsJob(tx, { organisationId: club.org.id, matchId, videoId: job.videoId! }),
    );
    const sendClips = vi.fn(async () => {});
    const run = (minutes: number) =>
      handleCvWatchdog({
        provider: new FakeGpuProvider(),
        resend: vi.fn(),
        sendClips,
        now: () => new Date(Date.now() + minutes * MIN),
      });
    await run(5);
    expect(sendClips.mock.calls.map((c) => (c as unknown as [{ id: string }])[0].id)).not.toContain(
      clips.id,
    );
    const summary = await run(11);
    expect(summary.clipsResent).toBeGreaterThanOrEqual(1);
    expect(sendClips.mock.calls.map((c) => (c as unknown as [{ id: string }])[0].id)).toContain(
      clips.id,
    );
  });

  it("backfills a clips job for a succeeded cv job that has none (C09)", async () => {
    const { job } = await setup();
    await rawDb.processingJob.update({
      where: { id: job.id },
      data: { status: "succeeded", attempts: 1, finishedAt: new Date() },
    });
    const sendClips = vi.fn(async () => {});
    const summary = await handleCvWatchdog({
      provider: new FakeGpuProvider(),
      resend: vi.fn(),
      sendClips,
    });
    expect(summary.clipsBackfilled).toBeGreaterThanOrEqual(1);
    const clips = await rawDb.processingJob.findFirstOrThrow({
      where: { videoId: job.videoId, type: "clips" },
    });
    expect(clips.status).toBe("queued");
    expect(sendClips.mock.calls.map((c) => (c as unknown as [{ id: string }])[0].id)).toContain(
      clips.id,
    );
    // Once is enough: the next run finds the clips job.
    await handleCvWatchdog({ provider: new FakeGpuProvider(), resend: vi.fn(), sendClips });
    expect(
      await rawDb.processingJob.count({ where: { videoId: job.videoId, type: "clips" } }),
    ).toBe(1);
  });

  it("sends an alert whose email failed, once, only for recent failures", async () => {
    // Three failed jobs whose alert never went out (the claim was given back):
    // 10 minutes ago (inside the window), 1 minute ago (the final-failure path
    // may still be sending) and 2 days ago (before the window).
    const failed = async (minutesAgo: number) => {
      const { job } = await setup();
      await rawDb.processingJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          attempts: 3,
          errorMessage: "invalid result",
          finishedAt: new Date(Date.now() - minutesAgo * MIN),
          alertedAt: null,
        },
      });
      return job;
    };
    const recent = await failed(10);
    const fresh = await failed(1);
    const old = await failed(2 * 24 * 60);
    const run = () =>
      handleCvWatchdog({ provider: new FakeGpuProvider(), resend: vi.fn(), sendClips: vi.fn() });

    expect((await run()).realerted).toBeGreaterThanOrEqual(1);
    const alerts = alertsFor(deliverMail.mock.calls, recent.id);
    expect(alerts.map((a) => a.to).sort()).toEqual(await platformAdminEmails());
    expect(alerts.map((a) => a.to)).toContain(admin.email);
    const row = await rawDb.processingJob.findUniqueOrThrow({ where: { id: recent.id } });
    expect(row.alertedAt).not.toBeNull();
    expect(alertsFor(deliverMail.mock.calls, fresh.id)).toHaveLength(0);
    expect(alertsFor(deliverMail.mock.calls, old.id)).toHaveLength(0);

    // Idempotent: a second run sends nothing more.
    await run();
    expect(alertsFor(deliverMail.mock.calls, recent.id)).toHaveLength(alerts.length);
  });
});
