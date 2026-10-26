import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/server/auth/session";
import { rawDb } from "@/server/db/raw";
import { CHOOSE_FROM_LIST, MatchError, ONE_SIDE_OWN } from "@/server/matches/errors";
import {
  deleteMatch,
  getMatch,
  listMatchesByStatus,
  sastMonth,
  updateMatch,
} from "@/server/matches/matches";
import { saveLineup } from "@/server/matches/lineups";
import { fixtures } from "./helpers/fixtures";
import { match, player, setupClub } from "./helpers/matches";

// MATCH01, MATCH08, BILL01, ADMIN05 (docs/build/design/C06.md, Surfaces 1, 2 and 6).

const boss = vi.hoisted(() => ({ send: vi.fn(async () => "job-id") }));
vi.mock("@/server/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/queue")>()),
  getBoss: async () => boss,
}));

// The delete action with a fixture session: requireRole runs the real role
// check against the context a request from that user would get.
const session = vi.hoisted(() => ({ ctx: null as AuthContext | null }));
vi.mock("@/server/auth/session", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/auth/session")>();
  return {
    ...real,
    requireRole: async (roles: readonly string[]) => {
      const ctx = session.ctx!;
      if (!ctx.roles.some((r) => roles.includes(r))) {
        throw new real.AuthzError(403, `Requires one of: ${roles.join(", ")}`);
      }
      return ctx;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;
let other: Awaited<ReturnType<typeof setupClub>>;

beforeAll(async () => {
  club = await setupClub(f, "Matches FC");
  other = await setupClub(f, "Matches Other FC");
});

afterAll(async () => {
  await f.cleanup();
});

beforeEach(() => boss.send.mockClear());

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => (e instanceof MatchError ? e.code : String(e)),
  );

const fieldErrorsOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) =>
      e instanceof MatchError ? (e.fieldErrors ?? { [e.field!]: e.userMessage }) : e,
  );

describe("create", () => {
  it("creates a match, audits it and records one matches usage row", async () => {
    const { id } = await match(club.coachCtx, club.own.id, club.opposition.id);
    const m = await getMatch(club.ctx, id);
    expect(m).toMatchObject({
      status: "draft",
      halfLengthMinutes: 45,
      venue: "Dobsonville Stadium",
    });
    expect(m.homeTeam.id).toBe(club.own.id);
    const audits = await rawDb.auditLog.findMany({
      where: { action: "match.created", targetId: id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({ withinMonthlyLimit: true });
    const usage = await rawDb.usageEvent.findMany({
      where: { organisationId: club.org.id, metric: "matches", sourceId: id },
    });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ quantity: BigInt(1), sourceType: "Match" });
  });

  it("refuses two opposition teams, the same team twice and another organisation's team", async () => {
    const opp2 = await rawDb.team.create({
      data: { organisationId: club.org.id, name: "Rivals B", season: "2026", isOpposition: true },
    });
    expect(await fieldErrorsOf(match(club.ctx, club.opposition.id, opp2.id))).toEqual({
      awayTeamId: ONE_SIDE_OWN,
    });
    expect(await fieldErrorsOf(match(club.ctx, club.own.id, club.own.id))).toMatchObject({
      issues: [expect.objectContaining({ message: "Choose a different team from the home team." })],
    });
    expect(await fieldErrorsOf(match(club.ctx, club.own.id, other.opposition.id))).toEqual({
      awayTeamId: CHOOSE_FROM_LIST,
    });
  });

  it("refuses a cross-organisation team in the database too (composite foreign key)", async () => {
    await expect(
      rawDb.match.create({
        data: {
          organisationId: club.org.id,
          homeTeamId: club.own.id,
          awayTeamId: other.opposition.id,
          playedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    await expect(
      rawDb.match.create({
        data: {
          organisationId: club.org.id,
          homeTeamId: club.own.id,
          awayTeamId: club.own.id,
          playedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/Match_home_ne_away/);
  });

  it("creates past matches_per_month and records that it was over (enforced in V201)", async () => {
    await rawDb.entitlement.create({
      data: {
        organisationId: other.org.id,
        key: "matches_per_month",
        source: "override",
        value: 1,
      },
    });
    await match(other.ctx, other.own.id, other.opposition.id);
    const { id } = await match(other.ctx, other.own.id, other.opposition.id);
    const audit = await rawDb.auditLog.findFirst({
      where: { action: "match.created", targetId: id },
    });
    expect(audit?.metadata).toMatchObject({ withinMonthlyLimit: false });
    expect(await getMatch(other.ctx, id)).toBeTruthy();
  });

  it("counts the month in South Africa", () => {
    const { from, to } = sastMonth(new Date("2026-10-31T23:30:00Z"));
    // 01:30 on 1 November in Johannesburg.
    expect(from.toISOString()).toBe("2026-10-31T22:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-30T22:00:00.000Z");
  });
});

describe("update", () => {
  it("saves changed fields only and audits their names", async () => {
    const { id } = await match(club.ctx, club.own.id, club.opposition.id);
    const input = {
      homeTeamId: club.own.id,
      awayTeamId: club.opposition.id,
      playedAt: "2026-10-19",
      venue: "Orlando Stadium",
      competition: "Gauteng Development League",
      halfLengthMinutes: 35,
    };
    expect(await updateMatch(club.coachCtx, id, input)).toEqual({
      changed: ["playedAt", "venue", "competition", "halfLengthMinutes"],
    });
    expect(await updateMatch(club.coachCtx, id, input)).toEqual({ changed: [] });
    const audits = await rawDb.auditLog.findMany({
      where: { action: "match.updated", targetId: id },
    });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0]!.metadata)).not.toContain("Orlando");
  });

  it("refuses a team change once that team's lineup has rows", async () => {
    const { id } = await match(club.ctx, club.own.id, club.opposition.id);
    const p = await player(club.ctx, club.own.id, 7);
    await saveLineup(club.ctx, id, club.own.id, [
      { playerId: p.id, isStarter: true, shirtNumber: 7, position: null },
    ]);
    const errors = await fieldErrorsOf(
      updateMatch(club.ctx, id, {
        homeTeamId: club.other.id,
        awayTeamId: club.opposition.id,
        playedAt: "2026-10-18",
        venue: "",
        competition: "",
        halfLengthMinutes: 45,
      }),
    );
    expect(errors).toEqual({
      homeTeamId: "Remove the home lineup first. It lists players from U15 Boys (2026).",
    });
    // Swapping sides keeps both teams, so it is allowed.
    expect(
      (
        await updateMatch(club.ctx, id, {
          homeTeamId: club.opposition.id,
          awayTeamId: club.own.id,
          playedAt: "2026-10-18",
          venue: "Dobsonville Stadium",
          competition: "",
          halfLengthMinutes: 45,
        })
      ).changed,
    ).toEqual(["homeTeamId", "awayTeamId"]);
  });
});

describe("list", () => {
  it("groups by status in pipeline order, and filters by team", async () => {
    const groups = await listMatchesByStatus(club.ctx);
    expect(groups.map((g) => g.status)).toEqual(["draft"]);
    const filtered = await listMatchesByStatus(club.ctx, { teamId: club.other.id });
    expect(filtered).toEqual([]);
    const theirs = await listMatchesByStatus(other.ctx);
    const mine = new Set(groups.flatMap((g) => g.matches.map((m) => m.id)));
    for (const m of theirs.flatMap((g) => g.matches)) expect(mine.has(m.id)).toBe(false);
  });
});

describe("delete", () => {
  it("cascades lineups and videos, audits ids only and enqueues the storage purge", async () => {
    const { id } = await match(club.ctx, club.own.id, club.opposition.id);
    const p = await player(club.ctx, club.own.id, 9);
    await saveLineup(club.ctx, id, club.own.id, [
      { playerId: p.id, isStarter: true, shirtNumber: 9, position: "ST" },
    ]);
    await rawDb.video.create({
      data: {
        id: `vid-${id}`,
        organisationId: club.org.id,
        matchId: id,
        blobPath: `orgs/${club.org.id}/matches/${id}/raw/vid-${id}.mp4`,
        fileName: "match.mp4",
        contentType: "video/mp4",
        sizeBytes: BigInt(100),
        partSize: 8 * 1024 * 1024,
        s3UploadId: "upload-1",
        fingerprint: "fp",
      },
    });

    await deleteMatch(club.ctx, id);

    expect(await codeOf(getMatch(club.ctx, id))).toBe("not_found");
    expect(await rawDb.lineup.count({ where: { matchId: id } })).toBe(0);
    expect(await rawDb.video.count({ where: { matchId: id } })).toBe(0);
    const audit = await rawDb.auditLog.findFirst({
      where: { action: "match.deleted", targetId: id },
    });
    expect(audit?.metadata).toEqual({ lineups: 1, videos: 1, videoIds: [`vid-${id}`] });
    expect(JSON.stringify(audit?.metadata)).not.toMatch(/Thabo|Nkosi|match\.mp4|U15/);
    // No upload ever completed, so nothing is raw footage yet: the purge starts at once.
    expect(boss.send).toHaveBeenCalledWith(
      "retention",
      {
        kind: "match_deleted",
        organisationId: club.org.id,
        matchId: id,
        prefix: `orgs/${club.org.id}/matches/${id}/`,
        rawExpiresAt: null,
        uploads: [
          { key: `orgs/${club.org.id}/matches/${id}/raw/vid-${id}.mp4`, uploadId: "upload-1" },
        ],
      },
      { startAfter: expect.any(Date) },
    );
  });

  it("refuses a coach (403) under the default roles: only owners and admins delete", async () => {
    const { deleteMatchAction } = await import("@/app/(app)/matches/[matchId]/actions");
    const { id } = await match(club.ctx, club.own.id, club.opposition.id);
    const form = new FormData();
    form.set("matchId", id);
    session.ctx = club.coachCtx;
    await expect(deleteMatchAction(null, form)).rejects.toMatchObject({ status: 403 });
    expect(await getMatch(club.ctx, id)).toBeTruthy();
    expect(boss.send).not.toHaveBeenCalled();
    session.ctx = club.ctx;
    await expect(deleteMatchAction(null, form)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await codeOf(getMatch(club.ctx, id))).toBe("not_found");
  });
});
