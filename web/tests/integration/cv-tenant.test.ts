import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ingestCvResult } from "@/server/cv/ingest";
import { requestInstance } from "@/server/cv/instances";
import { rawDb } from "@/server/db/raw";
import { scopedDb, TenantScopeError } from "@/server/db/scoped";
import { fixtures } from "./helpers/fixtures";
import {
  event,
  FakeGpuProvider,
  onLineup,
  playerWithConsent,
  result,
  runningCvJob,
  track,
} from "./helpers/cv";
import { match, setupClub } from "./helpers/matches";
import { acceptedVideo } from "./helpers/transcode";

// C08 tenant isolation (NFR16) for Track, TrackPoint, Event and GpuInstance.
// B's scoped client sees none of A's CV output and cannot write into it; the
// composite foreign keys refuse a row pointing at another organisation's
// match, job, track or player (P2003); GpuInstance and
// Organisation.gpuInstances are refused by the scoped client outright.

vi.mock("@/server/consent/jobs", () => ({ enqueueConsentWithdrawn: vi.fn(async () => {}) }));

const f = fixtures();
let a: Awaited<ReturnType<typeof setupClub>>;
let b: Awaited<ReturnType<typeof setupClub>>;
let matchA: string;
let matchB: string;
let jobA: string;
let trackA: string;
let playerA: string;
let jobB: string;

beforeAll(async () => {
  a = await setupClub(f, "Tenant CV A");
  b = await setupClub(f, "Tenant CV B");
  matchA = (await match(a.ctx, a.own.id, a.opposition.id)).id;
  matchB = (await match(b.ctx, b.own.id, b.opposition.id)).id;
  const videoA = (await acceptedVideo(a.org.id, matchA)).video.id;
  const videoB = (await acceptedVideo(b.org.id, matchB)).video.id;
  const job = await runningCvJob(a.org.id, matchA, videoA);
  jobA = job.id;
  jobB = (await runningCvJob(b.org.id, matchB, videoB)).id;
  playerA = (await playerWithConsent(a.ctx, a.own.id, "club_only")).id;
  await onLineup(a.org.id, matchA, a.own.id, playerA, 7);
  await ingestCvResult({
    job,
    videoId: videoA,
    result: result(job, [track(0, "home", 7, 0.9)], [event("shot", 0, 0.9)]),
    resultKey: "k",
    resultBytes: 1,
    resultSha256: "e".repeat(64),
    attempt: 1,
    provider: "fake",
    realtimeFactor: null,
    startupMs: null,
  });
  trackA = (await rawDb.track.findFirstOrThrow({ where: { matchId: matchA } })).id;
  await requestInstance(job, 1, new FakeGpuProvider());
});

afterAll(async () => {
  await f.cleanup();
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "no error";
  } catch (err) {
    return (err as { code?: string }).code ?? (err as Error).name;
  }
}

describe("cv tenant isolation", () => {
  it("shows B none of A's tracks, points or events, and A its own", async () => {
    const dbB = scopedDb(b.org.id);
    expect(await dbB.track.count({ where: { matchId: matchA } })).toBe(0);
    expect(await dbB.trackPoint.count({ where: { matchId: matchA } })).toBe(0);
    expect(await dbB.event.count({ where: { matchId: matchA } })).toBe(0);
    const dbA = scopedDb(a.org.id);
    expect(await dbA.track.count({ where: { matchId: matchA } })).toBe(1);
    expect(await dbA.trackPoint.count({ where: { matchId: matchA } })).toBe(3);
    expect(await dbA.event.count({ where: { matchId: matchA } })).toBe(1);
  });

  it("lets B change or delete none of A's rows", async () => {
    const dbB = scopedDb(b.org.id);
    expect(
      (await dbB.event.updateMany({ where: { matchId: matchA }, data: { status: "rejected" } }))
        .count,
    ).toBe(0);
    expect((await dbB.track.deleteMany({ where: { id: trackA } })).count).toBe(0);
    expect((await dbB.trackPoint.deleteMany({ where: { matchId: matchA } })).count).toBe(0);
    expect(await rawDb.track.count({ where: { id: trackA } })).toBe(1);
  });

  it("refuses a scoped write naming another organisation", async () => {
    const dbB = scopedDb(b.org.id);
    await expect(
      dbB.event.create({
        data: {
          organisationId: a.org.id,
          matchId: matchA,
          type: "goal",
          status: "manual",
          timestampMs: 1,
        },
      }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  it("refuses rows pointing at another organisation's match, job, track or player (P2003)", async () => {
    const base = { organisationId: b.org.id, trackIndex: 9, teamSide: "home" as const };
    expect(
      await code(rawDb.track.create({ data: { ...base, matchId: matchA, jobId: jobB } })),
    ).toBe("P2003");
    expect(
      await code(rawDb.track.create({ data: { ...base, matchId: matchB, jobId: jobA } })),
    ).toBe("P2003");
    expect(
      await code(
        rawDb.track.create({
          data: { ...base, matchId: matchB, jobId: jobB, playerId: playerA, linkedBy: "cv" },
        }),
      ),
    ).toBe("P2003");
    const ev = { organisationId: b.org.id, matchId: matchB, type: "shot" as const, timestampMs: 5 };
    expect(
      await code(rawDb.event.create({ data: { ...ev, status: "auto_accepted", trackId: trackA } })),
    ).toBe("P2003");
    expect(
      await code(rawDb.event.create({ data: { ...ev, status: "manual", playerId: playerA } })),
    ).toBe("P2003");
    expect(
      await code(
        rawDb.trackPoint.create({
          data: { organisationId: b.org.id, matchId: matchB, trackId: trackA, tMs: 1, x: 1, y: 1 },
        }),
      ),
    ).toBe("P2003");
  });

  it("refuses GpuInstance and Organisation.gpuInstances in a scoped client", async () => {
    const dbA = scopedDb(a.org.id) as unknown as {
      gpuInstance: { findMany: () => Promise<unknown> };
      organisation: { findFirst: (args: object) => Promise<unknown> };
    };
    await expect(dbA.gpuInstance.findMany()).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      dbA.organisation.findFirst({ include: { gpuInstances: true } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });
});
