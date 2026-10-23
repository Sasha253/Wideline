import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db/raw";
import { scopedDb, TenantScopeError } from "@/server/db/scoped";
import { ensureScoutNetwork, SCOUT_NETWORK_ORG_ID } from "@/server/scouts/network";

// NFR-16: a user from organisation B cannot read or change organisation A's
// data through the scoped client.

const tag = randomUUID().slice(0, 8);
let orgA: string;
let orgB: string;
let matchA: string;
let playerA: string;
let teamB: string;
let userA: string;
let invitationA: string;

async function makeOrg(name: string) {
  // Organisations default to pending (ADMIN01); these fixtures are approved ones.
  const org = await rawDb.organisation.create({
    data: { name: `${name} ${tag}`, type: "club", status: "active" },
  });
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
  const invitation = await rawDb.invitation.create({
    data: {
      organisationId: orgA,
      email: `invitee-${tag}@test.local`,
      role: "coach",
      tokenHash: `hash-${tag}`,
      invitedById: userA,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  invitationA = invitation.id;
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

  it("refuses platform-only organisation fields", async () => {
    const asA = scopedDb(orgA);
    for (const data of [
      { status: "active" as const },
      { planId: "free" },
      { reviewedAt: new Date() },
      { rejectionReason: "x" },
      { applicantEmail: "x@test.local" },
      { applicantName: "x" },
      { type: "platform" as const },
      { type: { set: "platform" as const } },
    ]) {
      await expect(asA.organisation.update({ where: { id: orgA }, data })).rejects.toBeInstanceOf(
        TenantScopeError,
      );
    }
    const org = await asA.organisation.update({ where: { id: orgA }, data: { region: "Gauteng" } });
    expect(org.region).toBe("Gauteng");
  });

  it("refuses nested relation writes on the organisation", async () => {
    const asA = scopedDb(orgA);
    await expect(
      asA.organisation.update({ where: { id: orgA }, data: { teams: { connect: { id: teamB } } } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    // teamB still belongs to B.
    expect((await rawDb.team.findUniqueOrThrow({ where: { id: teamB } })).organisationId).toBe(
      orgB,
    );
  });
});

describe("scoped client: invitations", () => {
  it("lists only the current organisation's invitations", async () => {
    expect(await scopedDb(orgB).invitation.findMany()).toEqual([]);
    expect((await scopedDb(orgA).invitation.findMany()).map((i) => i.id)).toEqual([invitationA]);
  });

  it("cannot read, update or delete another organisation's invitation", async () => {
    const asB = scopedDb(orgB);
    expect(await asB.invitation.findUnique({ where: { id: invitationA } })).toBeNull();
    const { count } = await asB.invitation.updateMany({
      where: { id: invitationA },
      data: { revokedAt: new Date() },
    });
    expect(count).toBe(0);
    await expect(
      asB.invitation.update({ where: { id: invitationA }, data: { revokedAt: new Date() } }),
    ).rejects.toThrow();
    expect((await asB.invitation.deleteMany({ where: { id: invitationA } })).count).toBe(0);
    const still = await rawDb.invitation.findUnique({ where: { id: invitationA } });
    expect(still?.revokedAt).toBeNull();
  });

  it("refuses to create an invitation in another organisation", async () => {
    await expect(
      scopedDb(orgB).invitation.create({
        data: {
          organisationId: orgA,
          email: "x@test.local",
          role: "coach",
          tokenHash: `other-${tag}`,
          expiresAt: new Date(),
        },
      }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  it("hides the user's invitation relations", async () => {
    const asA = scopedDb(orgA);
    await expect(
      asA.user.findFirst({ where: { id: userA }, include: { invitationsSent: true } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      asA.user.findFirst({ where: { id: userA }, include: { invitationsAccepted: true } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      asA.invitation.findFirst({ include: { invitedBy: { include: { sessions: true } } } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      asA.invitation.findFirst({ include: { acceptedBy: { select: { accounts: true } } } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });
});

// C02: the scout tables are global and scout-owned. No organisation reaches them,
// and the scout network organisation shows no other organisation's data.
describe("scoped client: scouts", () => {
  it("refuses ScoutProfile and ScoutAffiliation outright", async () => {
    const asA = scopedDb(orgA);
    await expect(asA.scoutProfile.findMany()).rejects.toBeInstanceOf(TenantScopeError);
    await expect(asA.scoutProfile.count()).rejects.toBeInstanceOf(TenantScopeError);
    await expect(asA.scoutAffiliation.findMany()).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      asA.scoutAffiliation.updateMany({ data: { organisationId: null } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  it("refuses scout relations on Organisation and User, at any depth", async () => {
    const asA = scopedDb(orgA);
    await expect(
      asA.organisation.findFirst({ include: { scoutAffiliations: true } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      asA.organisation.findFirst({ select: { _count: { select: { scoutAffiliations: true } } } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      asA.membership.findFirst({
        include: { organisation: { include: { scoutAffiliations: true } } },
      }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      asA.user.findFirst({ where: { id: userA }, include: { scoutProfile: true } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      asA.user.findFirst({ where: { id: userA }, select: { scoutProfile: true } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      asA.membership.findFirst({ include: { user: { select: { scoutProfile: true } } } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      asA.user.findFirst({ where: { scoutProfile: { is: { status: "approved" } } } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  it("refuses making an organisation the scout network", async () => {
    const asA = scopedDb(orgA);
    await expect(
      asA.organisation.update({ where: { id: orgA }, data: { type: "scout_network" } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      asA.organisation.update({ where: { id: orgA }, data: { type: { set: "scout_network" } } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  it("shows the scout network none of another organisation's teams, players or matches", async () => {
    await ensureScoutNetwork();
    const asNetwork = scopedDb(SCOUT_NETWORK_ORG_ID);
    expect(await asNetwork.team.findMany()).toEqual([]);
    expect(await asNetwork.player.findMany()).toEqual([]);
    expect(await asNetwork.match.findMany()).toEqual([]);
    expect(await asNetwork.match.findUnique({ where: { id: matchA } })).toBeNull();
    expect(await asNetwork.player.findFirst({ where: { id: playerA } })).toBeNull();
    expect(await asNetwork.user.findFirst({ where: { id: userA } })).toBeNull();
    const org = await asNetwork.organisation.findFirst();
    expect(org?.id).toBe(SCOUT_NETWORK_ORG_ID);
  });
});
