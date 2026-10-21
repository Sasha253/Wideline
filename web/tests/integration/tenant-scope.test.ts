import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db/raw";
import { scopedDb, TenantScopeError } from "@/server/db/scoped";

// NFR-16: a user from organisation B cannot read or change organisation A's
// data through the scoped client.

const tag = randomUUID().slice(0, 8);
let orgA: string;
let orgB: string;
let matchA: string;
let playerA: string;
let teamB: string;
let userA: string;

async function makeOrg(name: string) {
  const org = await rawDb.organisation.create({ data: { name: `${name} ${tag}`, type: "club" } });
  const [home, away] = await Promise.all(
    ["Home", "Away"].map((n) =>
      rawDb.team.create({ data: { organisationId: org.id, name: n, season: "2026" } }),
    ),
  );
  const player = await rawDb.player.create({
    data: { organisationId: org.id, teamId: home!.id, isPlaceholder: true, squadNumber: 9 },
  });
  const match = await rawDb.match.create({
    data: {
      organisationId: org.id,
      homeTeamId: home!.id,
      awayTeamId: away!.id,
      playedAt: new Date(),
    },
  });
  return { org: org.id, match: match.id, player: player.id, team: home!.id };
}

beforeAll(async () => {
  const a = await makeOrg("Org A");
  const b = await makeOrg("Org B");
  orgA = a.org;
  orgB = b.org;
  matchA = a.match;
  playerA = a.player;
  teamB = b.team;
  const user = await rawDb.user.create({
    data: { id: randomUUID(), email: `a-${tag}@test.local`, name: "A only" },
  });
  userA = user.id;
  await rawDb.membership.create({
    data: { organisationId: orgA, userId: userA, role: "coach", acceptedAt: new Date() },
  });
});

afterAll(async () => {
  await rawDb.organisation.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await rawDb.user.deleteMany({ where: { id: userA } });
  await rawDb.$disconnect();
});

describe("scoped client", () => {
  it("lists only the current organisation's matches", async () => {
    const asB = scopedDb(orgB);
    const matches = await asB.match.findMany();
    expect(matches.length).toBe(1);
    expect(matches.every((m) => m.organisationId === orgB)).toBe(true);
  });

  it("cannot read another organisation's match by id", async () => {
    const asB = scopedDb(orgB);
    expect(await asB.match.findUnique({ where: { id: matchA } })).toBeNull();
    expect(await asB.match.findFirst({ where: { id: matchA } })).toBeNull();
    expect(await asB.match.count({ where: { id: matchA } })).toBe(0);
  });

  it("cannot update or delete another organisation's match", async () => {
    const asB = scopedDb(orgB);
    await expect(
      asB.match.update({ where: { id: matchA }, data: { venue: "hijacked" } }),
    ).rejects.toThrow();
    const { count } = await asB.match.deleteMany({ where: { id: matchA } });
    expect(count).toBe(0);
    const still = await rawDb.match.findUnique({ where: { id: matchA } });
    expect(still?.venue).not.toBe("hijacked");
  });

  it("refuses to create or move rows into another organisation", async () => {
    const asB = scopedDb(orgB);
    await expect(
      asB.team.create({ data: { organisationId: orgA, name: "x", season: "2026" } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(asB.team.updateMany({ data: { organisationId: orgA } })).rejects.toBeInstanceOf(
      TenantScopeError,
    );
  });

  it("stamps the current organisation on creates", async () => {
    const asB = scopedDb(orgB);
    // organisationId is required by the generated types; the extension
    // overwrites it, so any value other than orgB is rejected above.
    const team = await asB.team.create({
      data: { organisationId: orgB, name: "Stamped", season: "2026" },
    });
    expect(team.organisationId).toBe(orgB);
  });

  it("blocks references to another organisation's rows at the database", async () => {
    const asB = scopedDb(orgB);
    const matchB = (await asB.match.findFirst())!;
    // Composite (organisationId, playerId) foreign key: orgA's player does not
    // exist under orgB, so the insert fails.
    await expect(
      asB.lineup.create({
        data: {
          organisationId: orgB,
          matchId: matchB.id,
          teamId: teamB,
          playerId: playerA,
          shirtNumber: 9,
        },
      }),
    ).rejects.toThrow();
  });

  it("shows only members of the organisation and hides private user relations", async () => {
    const asB = scopedDb(orgB);
    expect(await asB.user.findFirst({ where: { id: userA } })).toBeNull();
    const asA = scopedDb(orgA);
    expect((await asA.user.findFirst({ where: { id: userA } }))?.id).toBe(userA);
    await expect(
      asA.user.findFirst({ where: { id: userA }, include: { memberships: true } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      asA.membership.findFirst({ include: { user: { include: { sessions: true } } } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  it("refuses the auth tables", async () => {
    await expect(scopedDb(orgA).session.findMany()).rejects.toBeInstanceOf(TenantScopeError);
  });

  it("reads only its own organisation record", async () => {
    const asB = scopedDb(orgB);
    expect(await asB.organisation.findUnique({ where: { id: orgA } })).toBeNull();
    expect((await asB.organisation.findFirst())?.id).toBe(orgB);
  });
});
