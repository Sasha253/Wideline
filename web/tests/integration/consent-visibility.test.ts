import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/server/auth/session";
import { rawDb } from "@/server/db/raw";
import { recordConsent, withdrawConsent } from "@/server/consent/records";
import { createConsentRequest } from "@/server/consent/requests";
import { attributablePlayerIds, consentVisibleTo, mayAttribute } from "@/server/consent/visibility";
import { scoutVisiblePlayers } from "@/server/scouts/visible-players";
import { createTeam } from "@/server/squad/teams";
import { guardianGrant, namedPlayer } from "./helpers/consent";
import { fixtures } from "./helpers/fixtures";

// C05 acceptance (CONS03, NFR11): a withdrawal hides the player from scout
// queries in the same request cycle. And consentVisibleTo / attributablePlayerIds
// (NFR08, data side) only pass granted players.

vi.mock("@/server/consent/jobs", () => ({ enqueueConsentWithdrawn: vi.fn(async () => {}) }));

const f = fixtures();
let ctx: AuthContext;
let orgId: string;
let teamId: string;
const scout = { roles: ["scout" as const] };

beforeAll(async () => {
  const org = await f.org("Consent visibility FC");
  orgId = org.id;
  const owner = await f.user("Visibility Owner");
  await f.member(org.id, owner.id, "owner");
  ctx = await f.ctx(owner, org.id);
  teamId = (await createTeam(ctx, { name: "U16 Girls", season: "2026" })).id;
});

afterAll(async () => {
  await f.cleanup();
});

describe("scout reads (acceptance)", () => {
  it("hides a player from the very next scout query after a withdrawal", async () => {
    const p = await namedPlayer(ctx, teamId);
    await recordConsent(ctx, p.id, guardianGrant());
    expect((await scoutVisiblePlayers(scout, { playerIds: [p.id] })).map((r) => r.id)).toEqual([
      p.id,
    ]);
    await withdrawConsent(ctx, p.id, { requestedBy: "Thandi Mokoena", method: "in_person" });
    expect(await scoutVisiblePlayers(scout, { playerIds: [p.id] })).toEqual([]);
  });

  it("hides a player from scouts after a change to club only", async () => {
    const p = await namedPlayer(ctx, teamId);
    await recordConsent(ctx, p.id, guardianGrant());
    const [row] = await scoutVisiblePlayers(scout, { playerIds: [p.id] });
    expect(row).toMatchObject({
      id: p.id,
      clubName: expect.stringContaining("Consent visibility"),
    });
    await recordConsent(ctx, p.id, guardianGrant({ scoutVisible: "no" }));
    expect(await scoutVisiblePlayers(scout, { playerIds: [p.id] })).toEqual([]);
  });

  it("never shows none, requested or club-only players to scouts", async () => {
    const none = await namedPlayer(ctx, teamId);
    const requested = await namedPlayer(ctx, teamId);
    await createConsentRequest(ctx, requested.id);
    const clubOnly = await namedPlayer(ctx, teamId);
    await recordConsent(ctx, clubOnly.id, guardianGrant({ scoutVisible: "no" }));
    const ids = [none.id, requested.id, clubOnly.id];
    expect(await scoutVisiblePlayers(scout, { playerIds: ids })).toEqual([]);
  });

  it("needs the scout role", async () => {
    await expect(scoutVisiblePlayers({ roles: ["coach"] }, { playerIds: [] })).rejects.toThrow(
      "scout",
    );
  });
});

describe("consentVisibleTo and attributablePlayerIds (NFR08)", () => {
  it("club_stats and attributablePlayerIds pass only club_only and scout_visible", async () => {
    const none = await namedPlayer(ctx, teamId);
    const requested = await namedPlayer(ctx, teamId);
    await createConsentRequest(ctx, requested.id);
    const withdrawn = await namedPlayer(ctx, teamId);
    await recordConsent(ctx, withdrawn.id, guardianGrant());
    await withdrawConsent(ctx, withdrawn.id, { requestedBy: "Thandi", method: "email" });
    const clubOnly = await namedPlayer(ctx, teamId);
    await recordConsent(ctx, clubOnly.id, guardianGrant({ scoutVisible: "no" }));
    const scoutVisible = await namedPlayer(ctx, teamId);
    await recordConsent(ctx, scoutVisible.id, guardianGrant());
    const all = [none, requested, withdrawn, clubOnly, scoutVisible].map((p) => p.id);

    const stats = await ctx.db.player.findMany({
      where: { id: { in: all }, ...consentVisibleTo({ kind: "club_stats" }) },
      select: { id: true },
    });
    expect(stats.map((r) => r.id).sort()).toEqual([clubOnly.id, scoutVisible.id].sort());

    const allowed = await attributablePlayerIds(ctx.db, orgId, all);
    expect([...allowed].sort()).toEqual([clubOnly.id, scoutVisible.id].sort());
    // The worker's raw client works too, and another organisation's id passes nothing.
    expect([...(await attributablePlayerIds(rawDb, "other-org", all))]).toEqual([]);

    const club = await ctx.db.player.findMany({
      where: { id: { in: all }, ...consentVisibleTo({ kind: "club" }) },
      select: { id: true },
    });
    expect(club).toHaveLength(5);
  });

  it("mayAttribute allows only a grant", () => {
    expect(mayAttribute("club_only")).toBe(true);
    expect(mayAttribute("scout_visible")).toBe(true);
    for (const s of ["none", "requested", "withdrawn"] as const)
      expect(mayAttribute(s)).toBe(false);
  });
});
