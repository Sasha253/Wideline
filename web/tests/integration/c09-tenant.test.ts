import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ingestCvResult } from "@/server/cv/ingest";
import { rawDb } from "@/server/db/raw";
import { scopedDb, TenantScopeError } from "@/server/db/scoped";
import { handleClips } from "@/worker/clips";
import { fakeCutter, ingestInput } from "./helpers/clips";
import { event, result, runningCvJob } from "./helpers/cv";
import { fixtures } from "./helpers/fixtures";
import { match, setupClub } from "./helpers/matches";
import { acceptedVideo } from "./helpers/transcode";

// C09 tenant isolation (NFR16) for Clip, ClipFavourite, PitchCalibration and
// BenchmarkTag: B's scoped client reads and changes none of A's rows and
// cannot write into A; the composite foreign keys refuse a row pointing at
// another organisation's match, event, clip or calibration (P2003, asserted by
// code); User.clipFavourites is refused by the scoped client.

vi.mock("@/server/mail-transport", () => ({ deliverMail: vi.fn(async () => {}) }));

const f = fixtures();
let a: Awaited<ReturnType<typeof setupClub>>;
let b: Awaited<ReturnType<typeof setupClub>>;
let matchA: string;
let matchB: string;
let videoB: string;
let clipA: string;
let eventA: string;
let calA: string;

beforeAll(async () => {
  a = await setupClub(f, "Tenant C09 A");
  b = await setupClub(f, "Tenant C09 B");
  matchA = (await match(a.ctx, a.own.id, a.opposition.id)).id;
  matchB = (await match(b.ctx, b.own.id, b.opposition.id)).id;
  const videoA = (await acceptedVideo(a.org.id, matchA, { durationSec: 120 })).video.id;
  videoB = (await acceptedVideo(b.org.id, matchB, { durationSec: 120 })).video.id;
  const job = await runningCvJob(a.org.id, matchA, videoA);
  const out = await ingestCvResult(
    ingestInput(job, videoA, result(job, [], [event("goal", null, 0.95, 30_000)])),
  );
  await handleClips(
    { organisationId: a.org.id, videoId: videoA, processingJobId: out.clipsJob!.id },
    { retryCount: 0, retryLimit: 2 },
    { cutter: fakeCutter().cutter },
  );
  const clip = await rawDb.clip.findFirstOrThrow({ where: { matchId: matchA } });
  clipA = clip.id;
  eventA = clip.eventId;
  calA = (await rawDb.video.findUniqueOrThrow({ where: { id: videoA } })).pitchCalibrationId!;
  await rawDb.clipFavourite.create({
    data: { organisationId: a.org.id, clipId: clipA, userId: a.owner.id },
  });
  await rawDb.benchmarkTag.create({
    data: {
      organisationId: a.org.id,
      matchId: matchA,
      type: "goal",
      timestampMs: 30_000,
      source: "hand",
      importBatchId: "batch-a",
    },
  });
}, 60_000);

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

describe("C09 tenant isolation", () => {
  it("shows B none of A's clips, favourites, calibrations or tags, and A its own", async () => {
    const dbB = scopedDb(b.org.id);
    expect(await dbB.clip.count({ where: { matchId: matchA } })).toBe(0);
    expect(await dbB.clipFavourite.count({ where: { clipId: clipA } })).toBe(0);
    expect(await dbB.pitchCalibration.count({ where: { id: calA } })).toBe(0);
    expect(await dbB.benchmarkTag.count({ where: { matchId: matchA } })).toBe(0);
    const dbA = scopedDb(a.org.id);
    expect(await dbA.clip.count({ where: { matchId: matchA } })).toBe(1);
    expect(await dbA.clipFavourite.count({ where: { clipId: clipA } })).toBe(1);
    expect(await dbA.pitchCalibration.count({ where: { id: calA } })).toBe(1);
    expect(await dbA.benchmarkTag.count({ where: { matchId: matchA } })).toBe(1);
  });

  it("lets B change or delete none of A's rows", async () => {
    const dbB = scopedDb(b.org.id);
    expect(
      (await dbB.clip.updateMany({ where: { id: clipA }, data: { deletedAt: new Date() } })).count,
    ).toBe(0);
    expect((await dbB.clipFavourite.deleteMany({ where: { clipId: clipA } })).count).toBe(0);
    expect((await dbB.pitchCalibration.deleteMany({ where: { id: calA } })).count).toBe(0);
    expect((await dbB.benchmarkTag.deleteMany({ where: { matchId: matchA } })).count).toBe(0);
    expect(await rawDb.clip.count({ where: { id: clipA, deletedAt: null } })).toBe(1);
  });

  it("refuses a scoped write naming another organisation", async () => {
    const dbB = scopedDb(b.org.id);
    await expect(
      dbB.benchmarkTag.create({
        data: {
          organisationId: a.org.id,
          matchId: matchA,
          type: "shot",
          timestampMs: 1,
          source: "hand",
          importBatchId: "x",
        },
      }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      dbB.clip.create({
        data: {
          organisationId: a.org.id,
          matchId: matchA,
          eventId: eventA,
          blobPath: "x",
          startMs: 0,
          endMs: 1000,
          sizeBytes: BigInt(1),
          width: 2,
          height: 2,
          baseExpiresAt: new Date(),
        },
      }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      dbB.clipFavourite.create({
        data: { organisationId: a.org.id, clipId: clipA, userId: a.owner.id },
      }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      dbB.pitchCalibration.create({
        data: {
          organisationId: a.org.id,
          cameraKey: "1920x1080",
          homography: [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ],
          imageWidth: 1920,
          imageHeight: 1080,
          confidence: 1,
          source: "manual",
        },
      }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    expect(await rawDb.clip.count({ where: { matchId: matchA } })).toBe(1);
    expect(await rawDb.clipFavourite.count({ where: { clipId: clipA } })).toBe(1);
    expect(
      await rawDb.pitchCalibration.count({ where: { organisationId: a.org.id, source: "manual" } }),
    ).toBe(0);
  });

  it("refuses rows pointing at another organisation's match, event, clip or calibration (P2003)", async () => {
    expect(
      await code(
        rawDb.clip.create({
          data: {
            organisationId: b.org.id,
            matchId: matchB,
            eventId: eventA,
            blobPath: "x",
            startMs: 0,
            endMs: 1000,
            sizeBytes: BigInt(1),
            width: 2,
            height: 2,
            baseExpiresAt: new Date(),
          },
        }),
      ),
    ).toBe("P2003");
    expect(
      await code(
        rawDb.clipFavourite.create({
          data: { organisationId: b.org.id, clipId: clipA, userId: b.owner.id },
        }),
      ),
    ).toBe("P2003");
    expect(
      await code(
        rawDb.benchmarkTag.create({
          data: {
            organisationId: b.org.id,
            matchId: matchA,
            type: "goal",
            timestampMs: 1,
            source: "hand",
            importBatchId: "x",
          },
        }),
      ),
    ).toBe("P2003");
    expect(
      await code(rawDb.video.update({ where: { id: videoB }, data: { pitchCalibrationId: calA } })),
    ).toBe("P2003");
  });

  it("refuses User.clipFavourites from a scoped client", async () => {
    const dbA = scopedDb(a.org.id);
    await expect(
      dbA.membership.findFirst({
        where: { userId: a.owner.id },
        include: { user: { include: { clipFavourites: true } } },
      }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });
});
