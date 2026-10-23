import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db/raw";
import { setActiveOrganisation } from "@/server/auth/organisations";
import { AuthzError, contextForSession } from "@/server/auth/session";
import { fixtures } from "./helpers/fixtures";

// C01 acceptance (AUTH05): switching organisation changes which data the
// scoped client returns. The active organisation lives on the session row.

const f = fixtures();
let orgA: { id: string; name: string };
let orgB: { id: string; name: string };
let matchA: string;
let matchB: string;
let user: { id: string; name: string; email: string };
let sessionId: string;

async function makeMatch(organisationId: string) {
  const [home, away] = await Promise.all(
    ["Home", "Away"].map((name) =>
      rawDb.team.create({ data: { organisationId, name, season: "2026" } }),
    ),
  );
  const match = await rawDb.match.create({
    data: { organisationId, homeTeamId: home!.id, awayTeamId: away!.id, playedAt: new Date() },
  });
  return match.id;
}

async function activeFromSession() {
  const s = await rawDb.session.findUniqueOrThrow({ where: { id: sessionId } });
  return contextForSession({ sessionId, user, activeOrganisationId: s.activeOrganisationId });
}

beforeAll(async () => {
  orgA = await f.org("Switch A");
  orgB = await f.org("Switch B");
  matchA = await makeMatch(orgA.id);
  matchB = await makeMatch(orgB.id);
  user = await f.user("Switcher");
  // A is the older membership, so it is the default.
  await f.member(orgA.id, user.id, "coach", new Date(Date.now() - 60_000));
  await f.member(orgB.id, user.id, "scout");
  await f.member(orgB.id, user.id, "agent");
  sessionId = (await f.session(user.id)).id;
});

afterAll(async () => {
  await f.cleanup();
});

describe("active organisation", () => {
  it("defaults to the oldest membership when the session has none", async () => {
    const ctx = await activeFromSession();
    expect(ctx.organisationId).toBe(orgA.id);
    expect(ctx.roles).toEqual(["coach"]);
  });

  it("lists every organisation with the user's roles, by name", async () => {
    const ctx = await activeFromSession();
    expect(ctx.organisations).toEqual([
      { id: orgA.id, name: orgA.name, type: "club", country: "ZA", region: null, roles: ["coach"] },
      {
        id: orgB.id,
        name: orgB.name,
        type: "club",
        country: "ZA",
        region: null,
        roles: ["scout", "agent"],
      },
    ]);
  });

  it("switching changes what the scoped client returns, and back again", async () => {
    await setActiveOrganisation(sessionId, user.id, orgB.id);
    const asB = await activeFromSession();
    expect(asB.organisationId).toBe(orgB.id);
    expect((await asB.db!.match.findMany()).map((m) => m.id)).toEqual([matchB]);

    await setActiveOrganisation(sessionId, user.id, orgA.id);
    const asA = await activeFromSession();
    expect(asA.organisationId).toBe(orgA.id);
    expect((await asA.db!.match.findMany()).map((m) => m.id)).toEqual([matchA]);
  });

  it("refuses an organisation without a membership, a pending one and a rejected one", async () => {
    const stranger = await f.org("Not mine");
    const pending = await f.org("Pending", { status: "pending" });
    const rejected = await f.org("Rejected", { status: "rejected" });
    await f.member(pending.id, user.id, "coach");
    await f.member(rejected.id, user.id, "coach");
    for (const org of [stranger, pending, rejected]) {
      const err = await setActiveOrganisation(sessionId, user.id, org.id).catch((e) => e);
      expect(err).toBeInstanceOf(AuthzError);
      expect(err.status).toBe(403);
    }
    // Neither pending nor rejected organisations count as memberships.
    expect((await activeFromSession()).organisations.map((o) => o.id)).toEqual([orgA.id, orgB.id]);
  });

  it("does not change another user's session", async () => {
    const other = await f.user("Other");
    await f.member(orgB.id, other.id, "coach");
    await expect(setActiveOrganisation(sessionId, other.id, orgB.id)).rejects.toBeInstanceOf(
      AuthzError,
    );
  });

  it("falls back to the remaining organisation when the active membership is removed", async () => {
    await setActiveOrganisation(sessionId, user.id, orgB.id);
    await rawDb.membership.deleteMany({ where: { organisationId: orgB.id, userId: user.id } });
    const ctx = await activeFromSession();
    expect(ctx.organisationId).toBe(orgA.id);
    expect((await ctx.db!.match.findMany()).map((m) => m.id)).toEqual([matchA]);
  });

  it("has no organisation when the user has no active membership", async () => {
    const loner = await f.user("Loner");
    const ctx = await contextForSession({
      sessionId: "x",
      user: loner,
      activeOrganisationId: null,
    });
    expect(ctx.organisationId).toBeNull();
    expect(ctx.db).toBeNull();
    expect(ctx.organisations).toEqual([]);
  });

  it("ignores a platform_admin membership outside the platform organisation", async () => {
    const stray = await f.user("Stray admin");
    await f.member(orgA.id, stray.id, "platform_admin");
    await f.member(orgA.id, stray.id, "coach");
    const ctx = await contextForSession({
      sessionId: "x",
      user: stray,
      activeOrganisationId: null,
    });
    expect(ctx.organisationId).toBe(orgA.id);
    expect(ctx.roles).toEqual(["coach"]);
  });
});
