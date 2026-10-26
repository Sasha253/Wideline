import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db/raw";
import { TenantScopeError } from "@/server/db/scoped";
import { saveLineup } from "@/server/matches/lineups";
import { fixtures } from "./helpers/fixtures";
import { match, player, setupClub } from "./helpers/matches";

// NFR16 for the C06 tables: Match, Lineup and the new Video. Organisation B's
// scoped client sees none of A's rows, cannot change or delete them, and the
// database refuses rows that point across organisations.

const f = fixtures();
let a: Awaited<ReturnType<typeof setupClub>>;
let b: Awaited<ReturnType<typeof setupClub>>;
let matchId: string;
let lineupId: string;
let videoId: string;

beforeAll(async () => {
  a = await setupClub(f, "Tenant A FC");
  b = await setupClub(f, "Tenant B FC");
  matchId = (await match(a.ctx, a.own.id, a.opposition.id)).id;
  const p = await player(a.ctx, a.own.id, 8);
  await saveLineup(a.ctx, matchId, a.own.id, [
    { playerId: p.id, isStarter: true, shirtNumber: 8, position: null },
  ]);
  lineupId = (await rawDb.lineup.findFirstOrThrow({ where: { matchId } })).id;
  videoId = (
    await a.ctx.db.video.create({
      data: {
        organisationId: a.org.id,
        matchId,
        blobPath: `orgs/${a.org.id}/matches/${matchId}/raw/x.mp4`,
        fileName: "match.mp4",
        contentType: "video/mp4",
        sizeBytes: BigInt(1000),
        partSize: 8 * 1024 * 1024,
        fingerprint: "fp",
      },
    })
  ).id;
});

afterAll(async () => {
  await f.cleanup();
});

describe("tenant isolation for matches, lineups and videos", () => {
  it("hides A's rows from B's scoped client", async () => {
    expect(await b.ctx.db.match.findFirst({ where: { id: matchId } })).toBeNull();
    expect(await b.ctx.db.lineup.findFirst({ where: { id: lineupId } })).toBeNull();
    expect(await b.ctx.db.video.findFirst({ where: { id: videoId } })).toBeNull();
    expect(await b.ctx.db.video.count()).toBe(0);
    // A sees its own.
    expect(await a.ctx.db.video.findFirst({ where: { id: videoId } })).not.toBeNull();
  });

  it("lets B change and delete none of A's rows", async () => {
    expect(
      (await b.ctx.db.video.updateMany({ where: { id: videoId }, data: { kickoffMs: 1 } })).count,
    ).toBe(0);
    await expect(
      b.ctx.db.video.update({ where: { id: videoId }, data: { kickoffMs: 1 } }),
    ).rejects.toMatchObject({ code: "P2025" });
    expect((await b.ctx.db.video.deleteMany({ where: { id: videoId } })).count).toBe(0);
    expect((await b.ctx.db.match.deleteMany({ where: { id: matchId } })).count).toBe(0);
    expect((await b.ctx.db.lineup.deleteMany({ where: { id: lineupId } })).count).toBe(0);
    await expect(b.ctx.db.match.delete({ where: { id: matchId } })).rejects.toMatchObject({
      code: "P2025",
    });
    const v = await rawDb.video.findUniqueOrThrow({ where: { id: videoId } });
    expect(v.kickoffMs).toBeNull();
    expect(await rawDb.match.count({ where: { id: matchId } })).toBe(1);
  });

  it("refuses a scoped write that names another organisation", async () => {
    await expect(
      b.ctx.db.video.create({
        data: {
          organisationId: a.org.id,
          matchId,
          blobPath: "x",
          fileName: "x.mp4",
          contentType: "video/mp4",
          sizeBytes: BigInt(1),
          partSize: 1,
          fingerprint: "fp",
        },
      }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  it("refuses a Video for another organisation's match in the database (composite FK)", async () => {
    await expect(
      b.ctx.db.video.create({
        data: {
          organisationId: b.org.id,
          matchId,
          // Not a live status, so the one-live-video index cannot be what refuses it.
          status: "cancelled",
          blobPath: "x",
          fileName: "x.mp4",
          contentType: "video/mp4",
          sizeBytes: BigInt(1),
          partSize: 1,
          fingerprint: "fp",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("refuses a Lineup replacement link across organisations (composite FK)", async () => {
    const bMatch = await match(b.ctx, b.own.id, b.opposition.id);
    const p = await player(b.ctx, b.own.id, 3);
    await saveLineup(b.ctx, bMatch.id, b.own.id, [
      { playerId: p.id, isStarter: false, shirtNumber: 3, position: null },
    ]);
    const bRow = await rawDb.lineup.findFirstOrThrow({ where: { matchId: bMatch.id } });
    await expect(
      rawDb.lineup.update({ where: { id: bRow.id }, data: { replacesLineupId: lineupId } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("keeps one live video per match (partial unique index)", async () => {
    await expect(
      rawDb.video.create({
        data: {
          organisationId: a.org.id,
          matchId,
          blobPath: "y",
          fileName: "y.mp4",
          contentType: "video/mp4",
          sizeBytes: BigInt(1),
          partSize: 1,
          fingerprint: "fp2",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    // A cancelled attempt does not count.
    await rawDb.video.create({
      data: {
        organisationId: a.org.id,
        matchId,
        status: "cancelled",
        blobPath: "z",
        fileName: "z.mp4",
        contentType: "video/mp4",
        sizeBytes: BigInt(1),
        partSize: 1,
        fingerprint: "fp3",
      },
    });
  });

  it("refuses markers out of order in the database", async () => {
    await expect(
      rawDb.video.update({ where: { id: videoId }, data: { kickoffMs: 5000, halfTimeMs: 4000 } }),
    ).rejects.toThrow(/Video_markers_ordered/);
  });
});
