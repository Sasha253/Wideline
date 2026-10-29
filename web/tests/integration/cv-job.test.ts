import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleCvCallback } from "@/server/cv/callback";
import { rawDb } from "@/server/db/raw";
import { moveToAwaitingReviewIfReady } from "@/server/processing/readiness";
import { handleCvJob, type CvDeps } from "@/worker/cv";
import { fixtures } from "./helpers/fixtures";
import { cvJob, event, FakeGpuProvider, result } from "./helpers/cv";
import { match, setupClub } from "./helpers/matches";
import { acceptedVideo } from "./helpers/transcode";

// C08 (CV01, NFR04, NFR06, NFR07): the CV job handler with a fake GPU
// provider, a fake clock and the worker played through the real callback
// handler. The happy path starts one instance, takes the worker's report,
// destroys the instance before reading the result, records its cost once
// (instance row, ProcessingJob.costCents and one gpu_cost_cents usage row with
// its currency and matchId), and ingests. A replayed delivery changes nothing.
// A match deleted mid-job stops the instance; a worker that exits without a
// report fails the attempt. The readiness check moves the match on whichever
// job finishes second, even when both finish at once.

vi.mock("@/server/mail-transport", () => ({ deliverMail: vi.fn(async () => {}) }));

const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;

beforeAll(async () => {
  club = await setupClub(f, "Dispatch FC");
});

afterAll(async () => {
  await f.cleanup();
});

async function setup() {
  const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
  const { video, job: transcode } = await acceptedVideo(club.org.id, matchId);
  const job = await cvJob(club.org.id, matchId, video.id);
  return { matchId, videoId: video.id, transcodeId: transcode.id, job };
}

/** A fake clock that the fake sleep moves on. */
function clock(start = new Date("2026-10-28T10:00:00Z")) {
  let t = start.getTime();
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

type Worker = (spec: { jobId: string; instanceId: string; callbackToken: string }) => Promise<void>;

/** Handler deps where each poll's sleep lets the fake worker act once. */
function deps(provider: FakeGpuProvider, worker: Worker, extra: Partial<CvDeps> = {}): CvDeps {
  const c = clock();
  let acted = false;
  return {
    provider,
    now: c.now,
    pollMs: 10_000,
    sleep: async (ms) => {
      c.advance(ms);
      if (acted) return;
      acted = true;
      await worker(JSON.parse(provider.started.at(-1)!.env.WIDELINE_JOB!));
    },
    ...extra,
  };
}

function reportAndLoad(job: { id: string; matchId: string }) {
  const json = result(job, [], [event("goal", null, 0.95, 5000)]);
  const bytes = Buffer.from(JSON.stringify(json));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const worker: Worker = async (spec) => {
    const res = await handleCvCallback(
      spec.jobId,
      `Bearer ${spec.callbackToken}`,
      JSON.stringify({ instanceId: spec.instanceId, kind: "succeeded", resultSha256: sha256 }),
    );
    expect(res.status).toBe(202);
  };
  const loadResult = vi.fn(async () => ({ json, bytes: bytes.length, sha256 }));
  return { worker, loadResult };
}

const meta = { retryCount: 0, retryLimit: 2 };

describe("handleCvJob", () => {
  it("runs one instance, records its cost once and ingests (happy path)", async () => {
    const { matchId, videoId, job } = await setup();
    const provider = new FakeGpuProvider();
    const { worker, loadResult } = reportAndLoad(job);
    const data = { organisationId: club.org.id, videoId, processingJobId: job.id };

    expect(await handleCvJob(data, meta, deps(provider, worker, { loadResult }))).toBe("succeeded");

    // One instance, started with ids and signed URLs only.
    expect(provider.started).toHaveLength(1);
    const spec = JSON.parse(provider.started[0]!.env.WIDELINE_JOB!);
    expect(Object.keys(spec).sort()).toEqual(
      [
        "attempt",
        "callbackToken",
        "callbackUrl",
        "durationSec",
        "fps",
        "instanceId",
        "jobId",
        "matchId",
        "resultUrl",
        "sampledFps",
        "videoUrl",
      ].sort(),
    );
    expect(spec.callbackUrl).toMatch(new RegExp(`/api/jobs/${job.id}/callback$`));
    expect(spec.resultUrl).toContain(`matches/${matchId}/cv/${job.id}/attempt-1/result.json`);

    // Destroyed before the result was read, billed 10 s at 36 USD an hour.
    const [instance] = await rawDb.gpuInstance.findMany({ where: { processingJobId: job.id } });
    expect(instance).toMatchObject({
      status: "destroyed",
      destroyReason: "job_done",
      billedSeconds: 10,
      costCents: 10,
      currency: "USD",
      resultStatus: "succeeded",
    });
    expect(provider.destroyed).toEqual([instance!.providerInstanceId]);
    expect(instance!.jobSettledAt).not.toBeNull();
    const usage = await rawDb.usageEvent.findMany({
      where: { metric: "gpu_cost_cents", sourceType: "GpuInstance", sourceId: instance!.id },
    });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ quantity: BigInt(10), currency: "USD" });
    expect(usage[0]!.metadata).toMatchObject({
      matchId,
      processingJobId: job.id,
      provider: "fake",
    });

    const row = await rawDb.processingJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({
      status: "succeeded",
      attempts: 1,
      costCents: 10,
      gpuProvider: "fake",
    });
    expect(await rawDb.event.count({ where: { matchId } })).toBe(1);
    // The transcode has not finished, so the match waits in Processing.
    expect((await rawDb.match.findUniqueOrThrow({ where: { id: matchId } })).status).toBe(
      "processing",
    );

    // A replayed delivery finds the job done and changes nothing (NFR06).
    expect(
      await handleCvJob(
        data,
        { retryCount: 1, retryLimit: 2 },
        deps(provider, worker, { loadResult }),
      ),
    ).toBe("skipped");
    expect(provider.started).toHaveLength(1);
    expect(await rawDb.gpuInstance.count({ where: { processingJobId: job.id } })).toBe(1);
    expect(
      await rawDb.usageEvent.count({ where: { metric: "gpu_cost_cents", sourceId: instance!.id } }),
    ).toBe(1);
    expect(loadResult).toHaveBeenCalledTimes(1);
  });

  it("stops the instance when the match is deleted mid-job", async () => {
    const { matchId, videoId, job } = await setup();
    const provider = new FakeGpuProvider();
    const worker: Worker = async () => {
      await rawDb.match.delete({ where: { id: matchId } });
    };
    const data = { organisationId: club.org.id, videoId, processingJobId: job.id };
    expect(await handleCvJob(data, meta, deps(provider, worker))).toBe("skipped");
    const [instance] = await rawDb.gpuInstance.findMany({ where: { processingJobId: job.id } });
    expect(instance).toMatchObject({ status: "destroyed", destroyReason: "job_gone" });
    expect(provider.destroyed).toHaveLength(1);
  });

  it("fails the attempt when the worker exits without a report", async () => {
    const { videoId, job } = await setup();
    const provider = new FakeGpuProvider();
    const worker: Worker = async () => {
      for (const id of provider.states.keys()) provider.states.set(id, "exited");
    };
    const data = { organisationId: club.org.id, videoId, processingJobId: job.id };
    await expect(handleCvJob(data, meta, deps(provider, worker))).rejects.toThrow(
      /worker exited without a result/,
    );
    const row = await rawDb.processingJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ status: "queued", attempts: 1 });
    expect(row.errorMessage).toBe("worker exited without a result");
    const [instance] = await rawDb.gpuInstance.findMany({ where: { processingJobId: job.id } });
    expect(instance).toMatchObject({ status: "destroyed", destroyReason: "attempt_failed" });
  });

  it("settles a cv job whose match left Processing, without starting anything", async () => {
    const { matchId, videoId, job } = await setup();
    await rawDb.match.update({ where: { id: matchId }, data: { status: "failed" } });
    const provider = new FakeGpuProvider();
    const data = { organisationId: club.org.id, videoId, processingJobId: job.id };
    expect(
      await handleCvJob(
        data,
        meta,
        deps(provider, async () => {}),
      ),
    ).toBe("skipped");
    expect(provider.started).toEqual([]);
    expect(await rawDb.processingJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "failed",
      attempts: 0,
    });
  });
});

describe("readiness", () => {
  it("moves the match on when the transcode finishes after the cv job", async () => {
    const { matchId, videoId, transcodeId, job } = await setup();
    await rawDb.processingJob.update({
      where: { id: job.id },
      data: { status: "succeeded", attempts: 1, startedAt: new Date(), finishedAt: new Date() },
    });
    await rawDb.$transaction(async (tx) => {
      await tx.processingJob.update({
        where: { id: transcodeId },
        data: { status: "succeeded", attempts: 1, startedAt: new Date(), finishedAt: new Date() },
      });
      expect(
        await moveToAwaitingReviewIfReady(tx, { organisationId: club.org.id, matchId, videoId }),
      ).toBe(true);
    });
    expect((await rawDb.match.findUniqueOrThrow({ where: { id: matchId } })).status).toBe(
      "awaiting_review",
    );
  });

  it("never misses the move when both jobs finish at the same time", async () => {
    for (let i = 0; i < 5; i++) {
      const { matchId, videoId, transcodeId, job } = await setup();
      const finish = (id: string) =>
        rawDb.$transaction(async (tx) => {
          await tx.processingJob.update({
            where: { id },
            data: {
              status: "succeeded",
              attempts: 1,
              startedAt: new Date(),
              finishedAt: new Date(),
            },
          });
          await new Promise((r) => setTimeout(r, 20));
          return moveToAwaitingReviewIfReady(tx, { organisationId: club.org.id, matchId, videoId });
        });
      const moved = await Promise.all([finish(transcodeId), finish(job.id)]);
      expect(moved.filter(Boolean)).toHaveLength(1);
      expect((await rawDb.match.findUniqueOrThrow({ where: { id: matchId } })).status).toBe(
        "awaiting_review",
      );
    }
  });
});
