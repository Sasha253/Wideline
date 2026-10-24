import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db/raw";
import type { AuthContext } from "@/server/auth/session";
import { isSquadNumberViolation, squadNumberTakenMessage } from "@/server/squad/errors";
import {
  ACTIVE_PLAYER,
  activePlayers,
  addPlaceholders,
  createPlayer,
  getPlayer,
  listPlayers,
  markDeparted,
  PlayerError,
  updatePlayer,
} from "@/server/squad/players";
import { createTeam, getTeam, listTeams, TeamError, updateTeam } from "@/server/squad/teams";
import { fixtures } from "./helpers/fixtures";

// SQUAD02, SQUAD04, SQUAD07, SQUAD09 and NFR16 for players
// (docs/build/design/C04.md, Surfaces 1, 2 and 5).

const f = fixtures();
let ctx: AuthContext;
let ctxB: AuthContext;
let orgId: string;
let u15: { id: string; name: string; season: string };
let u15Next: { id: string };
let u16: { id: string };
let opposition: { id: string };

beforeAll(async () => {
  const org = await f.org("Squad players FC");
  const orgB = await f.org("Squad players B FC");
  orgId = org.id;
  const owner = await f.user("Players Owner");
  const ownerB = await f.user("Players Owner B");
  await f.member(org.id, owner.id, "owner");
  await f.member(orgB.id, ownerB.id, "admin");
  ctx = await f.ctx(owner, org.id);
  ctxB = await f.ctx(ownerB, orgB.id);
  u15 = await createTeam(ctx, { name: "U15 Boys", season: "2026" });
  u15Next = await createTeam(ctx, { name: "U15 Boys", season: "2027" });
  u16 = await createTeam(ctx, { name: "U16 Boys", season: "2026" });
  opposition = await createTeam(ctx, { name: "Rivals U15", season: "2026" }, "opposition");
});

afterAll(async () => {
  await f.cleanup();
});

const thabo = (extra: Record<string, string> = {}) => ({
  firstName: "Thabo",
  lastName: "Nkosi",
  dateOfBirth: "2011-03-14",
  teamId: u15.id,
  ...extra,
});

const errorOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e as PlayerError,
  );

describe("squad numbers (SQUAD04)", () => {
  it("rejects a duplicate number on the same team with the clear message", async () => {
    await createPlayer(ctx, thabo({ squadNumber: "7" }));
    const err = await errorOf(
      createPlayer(ctx, { ...thabo({ squadNumber: "7" }), firstName: "Sipho" }),
    );
    expect(err).toBeInstanceOf(PlayerError);
    expect(err!.code).toBe("squad_number_taken");
    expect(err!.field).toBe("squadNumber");
    expect(err!.userMessage).toBe(
      "Number 7 is already taken in U15 Boys (2026) by Thabo Nkosi. Choose another number.",
    );
  });

  it("allows the same number on another team, or the same team name in another season", async () => {
    await createPlayer(ctx, thabo({ squadNumber: "7", teamId: u16.id, firstName: "Kagiso" }));
    await createPlayer(ctx, thabo({ squadNumber: "7", teamId: u15Next.id, firstName: "Lwazi" }));
  });

  it("maps a concurrent insert on the partial unique index to the same message without the name", async () => {
    const raw = await rawDb.player
      .create({
        data: {
          organisationId: orgId,
          teamId: u15.id,
          firstName: "Raw",
          lastName: "Row",
          squadNumber: 7,
        },
      })
      .catch((e: unknown) => e);
    expect(isSquadNumberViolation(raw)).toBe(true);
    expect(squadNumberTakenMessage(7, u15)).toBe(
      "Number 7 is already taken in U15 Boys (2026). Choose another number.",
    );
  });

  it("frees a departed player's number, and updates refuse a taken number", async () => {
    const p = await createPlayer(ctx, thabo({ squadNumber: "11", firstName: "Bongani" }));
    const other = await createPlayer(ctx, thabo({ squadNumber: "12", firstName: "Musa" }));
    const err = await errorOf(
      updatePlayer(ctx, other.id, thabo({ squadNumber: "11", firstName: "Musa" })),
    );
    expect(err!.userMessage).toContain("by Bongani Nkosi");
    await markDeparted(ctx, p.id);
    await updatePlayer(ctx, other.id, thabo({ squadNumber: "11", firstName: "Musa" }));
    expect((await getPlayer(ctx, other.id)).squadNumber).toBe(11);
  });
});

describe("departure (SQUAD09)", () => {
  it("changes only clubStatus and departedAt, and keeps every lineup and match", async () => {
    const p = await createPlayer(ctx, thabo({ squadNumber: "9", firstName: "Ayanda" }));
    const match = await rawDb.match.create({
      data: {
        organisationId: orgId,
        homeTeamId: u15.id,
        awayTeamId: opposition.id,
        playedAt: new Date(),
      },
    });
    await rawDb.lineup.create({
      data: {
        organisationId: orgId,
        matchId: match.id,
        teamId: u15.id,
        playerId: p.id,
        shirtNumber: 9,
      },
    });
    const snapshot = async () => ({
      player: await rawDb.player.findUniqueOrThrow({ where: { id: p.id } }),
      lineups: await rawDb.lineup.findMany({ where: { playerId: p.id }, orderBy: { id: "asc" } }),
      match: await rawDb.match.findUniqueOrThrow({ where: { id: match.id } }),
    });
    const before = await snapshot();
    const at = new Date("2026-10-24T09:00:00Z");
    expect(await markDeparted(ctx, p.id, at)).toEqual({
      name: "Ayanda Nkosi",
      firstName: "Ayanda",
    });
    const after = await snapshot();

    // Every column but clubStatus and departedAt (and Prisma's updatedAt) is unchanged.
    const strip = (row: typeof after.player) =>
      Object.fromEntries(
        Object.entries(row).filter(([k]) => !["clubStatus", "departedAt", "updatedAt"].includes(k)),
      );
    expect(after.player.clubStatus).toBe("departed");
    expect(after.player.departedAt).toEqual(at);
    expect(strip(after.player)).toEqual(strip(before.player));
    expect(after.lineups).toEqual(before.lineups);
    expect(after.lineups).toHaveLength(1);
    expect(after.match).toEqual(before.match);

    const [row] = await rawDb.auditLog.findMany({
      where: { organisationId: orgId, action: "player.depart", targetId: p.id },
    });
    expect(row?.metadata).toEqual({ teamId: u15.id });
  });

  it("makes the player read-only and drops them from active lists", async () => {
    const p = await createPlayer(ctx, thabo({ squadNumber: "20", firstName: "Neo" }));
    expect((await activePlayers(ctx, { teamId: u15.id })).map((r) => r.id)).toContain(p.id);
    await markDeparted(ctx, p.id);

    const update = await errorOf(updatePlayer(ctx, p.id, thabo({ firstName: "Neo" })));
    expect(update!.code).toBe("departed");
    expect(update!.userMessage).toBe(
      "Neo Nkosi has left the club, so their details can no longer be changed.",
    );
    expect((await errorOf(markDeparted(ctx, p.id)))!.code).toBe("departed");

    expect((await activePlayers(ctx, { teamId: u15.id })).map((r) => r.id)).not.toContain(p.id);
    const current = await listPlayers(ctx, { teamId: u15.id, status: "current" });
    const departed = await listPlayers(ctx, { teamId: u15.id, status: "departed" });
    expect(current.map((r) => r.id)).not.toContain(p.id);
    expect(departed.map((r) => r.id)).toContain(p.id);
    expect(await rawDb.player.count({ where: { id: p.id, ...ACTIVE_PLAYER } })).toBe(0);
    // Team counts leave departed players out.
    const team = await getTeam(ctx, u15.id);
    expect(team.departedCount).toBeGreaterThanOrEqual(1);
    const listed = (await listTeams(ctx)).own.find((t) => t.id === u15.id)!;
    expect(listed.activeCount).toBe(team.activeCount);
  });
});

describe("opposition placeholders (SQUAD07)", () => {
  it("adds placeholders to opposition teams only, all or nothing", async () => {
    expect(await addPlaceholders(ctx, opposition.id, [1, 2, 3, 3])).toEqual({ added: 3 });
    const rows = await activePlayers(ctx, { teamId: opposition.id });
    expect(rows.map((r) => [r.squadNumber, r.isPlaceholder, r.firstName, r.dateOfBirth])).toEqual([
      [1, true, null, null],
      [2, true, null, null],
      [3, true, null, null],
    ]);
    const taken = await errorOf(addPlaceholders(ctx, opposition.id, [3, 4, 2]));
    expect(taken!.userMessage).toBe(
      "Numbers 2 and 3 are already on this team. Remove them from the list and try again.",
    );
    expect(await activePlayers(ctx, { teamId: opposition.id })).toHaveLength(3);
    expect((await errorOf(addPlaceholders(ctx, u15.id, [50])))!.code).toBe("wrong_team_kind");
    // Placeholders never show in the squad list.
    const all = await listPlayers(ctx, { status: "current" });
    expect(all.some((r) => r.team?.id === opposition.id)).toBe(false);
  });

  it("refuses named players on opposition teams and edits of placeholders", async () => {
    const err = await errorOf(createPlayer(ctx, thabo({ teamId: opposition.id })));
    expect(err!.code).toBe("wrong_team_kind");
    expect(err!.field).toBe("teamId");
    const [placeholder] = await activePlayers(ctx, { teamId: opposition.id });
    expect((await errorOf(updatePlayer(ctx, placeholder!.id, thabo())))!.code).toBe(
      "placeholder_only",
    );
  });
});

describe("audit (NFR20, CONS)", () => {
  it("records field names only: no names or dates of birth", async () => {
    const p = await createPlayer(ctx, thabo({ firstName: "Zanele", squadNumber: "30" }));
    await updatePlayer(
      ctx,
      p.id,
      thabo({ firstName: "Zanele", lastName: "Dube", squadNumber: "30" }),
    );
    const rows = await rawDb.auditLog.findMany({
      where: { organisationId: orgId, targetId: p.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((r) => r.action)).toEqual(["player.create", "player.update"]);
    expect(rows[1]!.metadata).toEqual({ changed: ["lastName"] });
    const text = JSON.stringify(rows.map((r) => r.metadata));
    for (const secret of ["Zanele", "Nkosi", "Dube", "2011"]) expect(text).not.toContain(secret);
  });
});

describe("tenant isolation (NFR16)", () => {
  it("organisation B cannot list, get, update or depart organisation A's team or player", async () => {
    const p = await createPlayer(ctx, thabo({ firstName: "Isolated", squadNumber: "44" }));
    expect((await listTeams(ctxB)).own).toEqual([]);
    expect(await listPlayers(ctxB, { status: "current" })).toEqual([]);
    expect(await activePlayers(ctxB, { teamId: u15.id })).toEqual([]);
    expect((await errorOf(getPlayer(ctxB, p.id)))!.code).toBe("not_found");
    expect((await errorOf(updatePlayer(ctxB, p.id, thabo())))!.code).toBe("not_found");
    expect((await errorOf(markDeparted(ctxB, p.id)))!.code).toBe("not_found");
    const teamErr = await getTeam(ctxB, u15.id).catch((e: unknown) => e);
    expect((teamErr as TeamError).code).toBe("not_found");
    const updErr = await updateTeam(ctxB, u15.id, { name: "Hijack", season: "2026" }).catch(
      (e: unknown) => e,
    );
    expect((updErr as TeamError).code).toBe("not_found");
    expect((await getPlayer(ctx, p.id)).clubStatus).toBe("active");
  });

  it("refuses a player on another organisation's team, in the service and in the database", async () => {
    expect((await errorOf(createPlayer(ctxB, thabo())))!.code).toBe("wrong_team_kind");
    // The composite foreign key refuses it even past the service.
    await expect(
      ctxB.db.player.create({
        data: {
          organisationId: ctxB.organisationId,
          teamId: u15.id,
          firstName: "X",
          lastName: "Y",
        },
      }),
    ).rejects.toThrow();
    expect((await errorOf(addPlaceholders(ctxB, opposition.id, [5])))!.code).toBe("not_found");
  });
});
