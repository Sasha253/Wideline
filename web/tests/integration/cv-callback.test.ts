import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/jobs/[jobId]/callback/route";
import { callbackToken, requestInstance, markInstanceStarted } from "@/server/cv/instances";
import { rawDb } from "@/server/db/raw";
import { markRunning } from "@/server/processing/jobs";
import { fixtures } from "./helpers/fixtures";
import { cvJob, FakeGpuProvider } from "./helpers/cv";
import { match, setupClub } from "./helpers/matches";
import { acceptedVideo } from "./helpers/transcode";

// C08 (CV01): the callback route with the real database. It records a
// heartbeat and the worker's outcome on the instance row, only the first
// outcome counts, and it answers 410 once the instance or the job is no
// longer live, so the worker stops. Bodies over 8 KB are refused unread.

const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;

beforeAll(async () => {
  club = await setupClub(f, "Callback FC");
});

afterAll(async () => {
  await f.cleanup();
});

async function live() {
  const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
  const { video } = await acceptedVideo(club.org.id, matchId);
  const job = (await markRunning(await cvJob(club.org.id, matchId, video.id), 1))!;
  const instance = await markInstanceStarted(
    await requestInstance(job, 1, new FakeGpuProvider()),
    "fake-1",
  );
  return { job, instance };
}

function post(jobId: string, token: string, body: unknown) {
  const req = new Request(`http://web:3000/api/jobs/${jobId}/callback`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ jobId }) });
}

describe("the CV callback route", () => {
  it("records a heartbeat, then the first outcome only", async () => {
    const { job, instance } = await live();
    const token = callbackToken(instance.id, job.id);
    expect((await post(job.id, token, { instanceId: instance.id, kind: "heartbeat" })).status).toBe(
      202,
    );
    expect(
      (await rawDb.gpuInstance.findUniqueOrThrow({ where: { id: instance.id } })).lastHeartbeatAt,
    ).not.toBeNull();

    const sha = "d".repeat(64);
    const done = { instanceId: instance.id, kind: "succeeded", resultSha256: sha };
    expect((await post(job.id, token, done)).status).toBe(202);
    expect(
      (await post(job.id, token, { instanceId: instance.id, kind: "failed", error: "late" }))
        .status,
    ).toBe(202);
    const row = await rawDb.gpuInstance.findUniqueOrThrow({ where: { id: instance.id } });
    expect(row).toMatchObject({ resultStatus: "succeeded", resultSha256: sha, resultError: null });
  });

  it("redacts a failure's URLs", async () => {
    const { job, instance } = await live();
    const token = callbackToken(instance.id, job.id);
    const error = "could not open http://rustfs:9000/b/raw.mp4?X-Amz-Signature=abc";
    await post(job.id, token, { instanceId: instance.id, kind: "failed", error });
    const row = await rawDb.gpuInstance.findUniqueOrThrow({ where: { id: instance.id } });
    expect(row.resultError).toBe("could not open http://rustfs:9000/b/raw.mp4?[redacted]");
  });

  it("accepts a callback before provider.start() has returned", async () => {
    const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
    const { video } = await acceptedVideo(club.org.id, matchId);
    const job = (await markRunning(await cvJob(club.org.id, matchId, video.id), 1))!;
    const instance = await requestInstance(job, 1, new FakeGpuProvider());
    const token = callbackToken(instance.id, job.id);
    const sha = "e".repeat(64);
    expect((await post(job.id, token, { instanceId: instance.id, kind: "heartbeat" })).status).toBe(
      202,
    );
    expect(
      (await post(job.id, token, { instanceId: instance.id, kind: "succeeded", resultSha256: sha }))
        .status,
    ).toBe(202);
    // The start that lands afterwards keeps the outcome.
    await markInstanceStarted(instance, "fake-late");
    const row = await rawDb.gpuInstance.findUniqueOrThrow({ where: { id: instance.id } });
    expect(row).toMatchObject({ status: "running", resultStatus: "succeeded", resultSha256: sha });
    expect(row.lastHeartbeatAt).not.toBeNull();
  });

  it("answers 410 for a destroyed instance or a settled job", async () => {
    const a = await live();
    await rawDb.gpuInstance.update({ where: { id: a.instance.id }, data: { status: "destroyed" } });
    const tokenA = callbackToken(a.instance.id, a.job.id);
    expect(
      (await post(a.job.id, tokenA, { instanceId: a.instance.id, kind: "heartbeat" })).status,
    ).toBe(410);

    const b = await live();
    await rawDb.processingJob.update({
      where: { id: b.job.id },
      data: { status: "failed", errorMessage: "x", finishedAt: new Date() },
    });
    const tokenB = callbackToken(b.instance.id, b.job.id);
    expect(
      (await post(b.job.id, tokenB, { instanceId: b.instance.id, kind: "heartbeat" })).status,
    ).toBe(410);
  });

  it("refuses another instance's token and a body over 8 KB", async () => {
    const a = await live();
    const b = await live();
    const wrong = callbackToken(b.instance.id, b.job.id);
    expect(
      (await post(a.job.id, wrong, { instanceId: a.instance.id, kind: "heartbeat" })).status,
    ).toBe(401);
    // B's token names B's job: a callback for B's instance under A's job is refused too.
    expect(
      (await post(a.job.id, wrong, { instanceId: b.instance.id, kind: "heartbeat" })).status,
    ).toBe(401);
    const big = JSON.stringify({
      instanceId: a.instance.id,
      kind: "failed",
      error: "x".repeat(9000),
    });
    const token = callbackToken(a.instance.id, a.job.id);
    expect((await post(a.job.id, token, big)).status).toBe(413);
  });
});
