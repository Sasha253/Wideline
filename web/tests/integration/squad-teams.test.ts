import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db/raw";
import type { AuthContext } from "@/server/auth/session";
import {
  createTeam,
  deleteTeam,
  getTeam,
  inUseMessage,
  listTeams,
  TeamError,
  updateTeam,
} from "@/server/squad/teams";
import { fixtures } from "./helpers/fixtures";

// SQUAD01, SQUAD07: teams of one organisation (docs/build/design/C04.md, Surfaces 3 and 4).

const f = fixtures();
let ctx: AuthContext;
let orgId: string;

beforeAll(async () => {
  const org = await f.org("Squad teams FC");
  orgId = org.id;
  const owner = await f.user("Team Owner");
  await f.member(org.id, owner.id, "owner");
  ctx = await f.ctx(owner, org.id);
});

afterAll(async () => {
  await f.cleanup();
});

const audits = (action: string, targetId: string) =>
  rawDb.auditLog.findMany({ where: { organisationId: orgId, action, targetId } });

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => (e instanceof TeamError ? e.code : String(e)),
  );

describe("teams", () => {
  it("creates, lists, updates and deletes a team, auditing ids only", async () => {
    const team = await createTeam(ctx, {
      name: "U15 Boys",
      ageGroup: "U15",
      gender: "Boys",
      season: "2026",
    });
    expect(team).toMatchObject({ name: "U15 Boys", isOpposition: false, activeCount: 0 });
    const opp = await createTeam(ctx, { name: "Rivals U15", season: "2026" }, "opposition");
    expect(opp.isOpposition).toBe(true);

    const lists = await listTeams(ctx);
    expect(lists.own.map((t) => t.id)).toContain(team.id);
    expect(lists.opposition.map((t) => t.id)).toEqual([opp.id]);

    expect(await updateTeam(ctx, team.id, { name: "U15 Boys A", season: "2026" })).toEqual({
      changed: ["name", "ageGroup", "gender"],
    });
    expect(await updateTeam(ctx, team.id, { name: "U15 Boys A", season: "2026" })).toEqual({
      changed: [],
    });
    expect((await getTeam(ctx, team.id)).name).toBe("U15 Boys A");

    const [created] = await audits("team.create", team.id);
    expect(created?.metadata).toEqual({ isOpposition: false });
    const updates = await audits("team.update", team.id);
    expect(updates).toHaveLength(1);
    expect(JSON.stringify(updates[0]!.metadata)).not.toContain("U15 Boys");

    await deleteTeam(ctx, team.id);
    expect(await codeOf(getTeam(ctx, team.id))).toBe("not_found");
    expect(await audits("team.delete", team.id)).toHaveLength(1);
  });

  it("refuses a duplicate name in the same season and allows it in another", async () => {
    await createTeam(ctx, { name: "U13 Girls", season: "2026" });
    expect(await codeOf(createTeam(ctx, { name: "u13 girls", season: "2026" }))).toBe(
      "duplicate_name",
    );
    const next = await createTeam(ctx, { name: "U13 Girls", season: "2027" });
    expect(await codeOf(updateTeam(ctx, next.id, { name: "U13 Girls", season: "2026" }))).toBe(
      "duplicate_name",
    );
  });

  it("refuses to delete a team with players, departed players or matches, naming the counts", async () => {
    const team = await createTeam(ctx, { name: "U17 Busy", season: "2026" });
    const player = await rawDb.player.create({
      data: {
        organisationId: orgId,
        teamId: team.id,
        firstName: "Lerato",
        lastName: "Mokoena",
        dateOfBirth: new Date("2010-05-01"),
      },
    });
    const err = await deleteTeam(ctx, team.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TeamError);
    expect((err as TeamError).code).toBe("in_use");
    expect((err as TeamError).detail.usage).toEqual({ players: 1, matches: 0, lineups: 0 });

    // A departed player still blocks: their history stays with the team.
    await rawDb.player.update({
      where: { id: player.id },
      data: { clubStatus: "departed", departedAt: new Date() },
    });
    expect(await codeOf(deleteTeam(ctx, team.id))).toBe("in_use");

    const empty = await createTeam(ctx, { name: "U17 Matches", season: "2026" });
    const away = await createTeam(ctx, { name: "Away side", season: "2026" }, "opposition");
    await rawDb.match.create({
      data: {
        organisationId: orgId,
        homeTeamId: empty.id,
        awayTeamId: away.id,
        playedAt: new Date(),
      },
    });
    const matchErr = (await deleteTeam(ctx, away.id).catch((e: unknown) => e)) as TeamError;
    expect(matchErr.detail.usage).toEqual({ players: 0, matches: 1, lineups: 0 });
    expect(await audits("team.delete", team.id)).toHaveLength(0);
  });

  it("writes team.delete in the same transaction as the delete", async () => {
    const team = await createTeam(ctx, { name: "U9 Audit", season: "2026" });
    // A trigger refuses this team's audit row: the delete must roll back with it.
    try {
      await rawDb.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION wl_test_block_audit() RETURNS trigger AS $$ BEGIN IF NEW.action = 'team.delete' AND NEW."targetId" = '${team.id}' THEN RAISE EXCEPTION 'blocked'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`,
      );
      await rawDb.$executeRawUnsafe(
        `CREATE TRIGGER wl_test_block_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION wl_test_block_audit()`,
      );
      await expect(deleteTeam(ctx, team.id)).rejects.toThrow();
      expect((await getTeam(ctx, team.id)).id).toBe(team.id);
    } finally {
      await rawDb.$executeRawUnsafe(`DROP TRIGGER IF EXISTS wl_test_block_audit ON "AuditLog"`);
      await rawDb.$executeRawUnsafe(`DROP FUNCTION IF EXISTS wl_test_block_audit()`);
    }
    await deleteTeam(ctx, team.id);
    expect(await audits("team.delete", team.id)).toHaveLength(1);
  });

  it("phrases the in-use reason with only the non-zero counts", () => {
    expect(inUseMessage({ players: 18, matches: 2, lineups: 0 }, false)).toContain(
      "because it has 18 players and 2 matches.",
    );
    expect(inUseMessage({ players: 11, matches: 0, lineups: 0 }, true)).toContain(
      "because it has 11 placeholder players.",
    );
    expect(inUseMessage({ players: 1, matches: 1, lineups: 3 }, false)).toContain(
      "1 player, 1 match and 3 lineups.",
    );
  });
});
