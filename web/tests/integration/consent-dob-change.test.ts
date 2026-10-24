import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DOB_CHANGED_WHILE_RECORDING } from "@/lib/consent-rules";
import { todayIso } from "@/lib/squad-fields";
import type { AuthContext } from "@/server/auth/session";
import { rawDb } from "@/server/db/raw";
import { recordConsent } from "@/server/consent/records";
import { attributablePlayerIds } from "@/server/consent/visibility";
import { scoutVisiblePlayers } from "@/server/scouts/visible-players";
import { updatePlayer } from "@/server/squad/players";
import { createTeam } from "@/server/squad/teams";
import { dobYearsAgo, guardianGrant, namedPlayer } from "./helpers/consent";
import { fixtures } from "./helpers/fixtures";

// CONS02, NFR08: whether a guardian must decide hangs on the date of birth. An
// edit that shows a player was under 18 when they consented themselves ends
// that grant: the player is no longer scout-visible or attributable.

const jobs = vi.hoisted(() => ({ enqueueConsentWithdrawn: vi.fn(async () => {}) }));
vi.mock("@/server/consent/jobs", () => jobs);

const f = fixtures();
let owner: AuthContext;
let coach: AuthContext;
let orgId: string;
let teamId: string;
const scout = { roles: ["scout" as const] };

beforeAll(async () => {
  const org = await f.org("Consent DOB FC");
  orgId = org.id;
  const o = await f.user("DOB Owner");
  await f.member(org.id, o.id, "owner");
  owner = await f.ctx(o, org.id);
  const c = await f.user("DOB Coach");
  await f.member(org.id, c.id, "coach");
  coach = await f.ctx(c, org.id);
  teamId = (await createTeam(owner, { name: "U19 Boys", season: "2026" })).id;
});

afterAll(async () => {
  await f.cleanup();
});

beforeEach(() => {
  jobs.enqueueConsentWithdrawn.mockClear();
});

/** The player's form fields as saved, with `dateOfBirth` replaced. */
async function withDob(playerId: string, dateOfBirth: string) {
  const p = await rawDb.player.findUniqueOrThrow({ where: { id: playerId } });
  return { firstName: p.firstName!, lastName: p.lastName!, teamId: p.teamId ?? "", dateOfBirth };
}

const selfGrant = (grantedAt = todayIso()) => ({
  relationship: "self",
  method: "in_person",
  grantedAt,
  clubStats: "yes",
  scoutVisible: "yes",
  seenWording: "on",
});

async function newest(playerId: string) {
  return rawDb.consent.findFirstOrThrow({ where: { playerId }, orderBy: { createdAt: "desc" } });
}

async function visibleAndAttributable(playerId: string) {
  return {
    scout: (await scoutVisiblePlayers(scout, { playerIds: [playerId] })).map((r) => r.id),
    attributable: [...(await attributablePlayerIds(rawDb, orgId, [playerId]))],
  };
}

describe("date of birth edits after an adult's own consent", () => {
  it("withdraws a self grant when the corrected date makes the player a minor", async () => {
    const p = await namedPlayer(owner, teamId, { age: 19, firstName: "Sipho" });
    await recordConsent(owner, p.id, selfGrant());
    expect(await visibleAndAttributable(p.id)).toEqual({ scout: [p.id], attributable: [p.id] });

    // A coach may edit the date of birth but not record consent: the edit still ends the grant.
    const res = await updatePlayer(coach, p.id, await withDob(p.id, dobYearsAgo(14, 10)));
    expect(res.consentWithdrawn).toBe(true);

    expect(await visibleAndAttributable(p.id)).toEqual({ scout: [], attributable: [] });
    const row = await newest(p.id);
    expect(row).toMatchObject({
      state: "withdrawn",
      clubStats: false,
      scoutVisible: false,
      playerWasMinor: true,
      recordedById: coach.user.id,
    });
    expect(row.withdrawnAt).not.toBeNull();
    const cached = await rawDb.player.findUniqueOrThrow({ where: { id: p.id } });
    expect(cached.consentState).toBe("withdrawn");

    const audits = await rawDb.auditLog.findMany({
      where: { targetId: p.id, action: "consent.withdraw" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({
      consentId: row.id,
      from: "scout_visible",
      to: "withdrawn",
      reason: "dob_corrected",
    });
    expect(JSON.stringify(audits[0]!.metadata)).not.toContain("Sipho");
    expect(jobs.enqueueConsentWithdrawn).toHaveBeenCalledWith({
      organisationId: orgId,
      playerId: p.id,
      consentId: row.id,
    });
  });

  it("refuses to clear the date of birth, so a self grant keeps its age check", async () => {
    const p = await namedPlayer(owner, teamId, { age: 22 });
    await recordConsent(owner, p.id, selfGrant());
    await expect(updatePlayer(owner, p.id, await withDob(p.id, ""))).rejects.toThrow(
      "Enter a date of birth.",
    );
    expect((await newest(p.id)).state).toBe("scout_visible");
  });

  it("judges on the decision date: adult today, minor when they consented", async () => {
    const p = await namedPlayer(owner, teamId, { age: 25 });
    await recordConsent(owner, p.id, selfGrant(dobYearsAgo(0, 180)));
    const res = await updatePlayer(owner, p.id, await withDob(p.id, dobYearsAgo(18, 10)));
    expect(res.consentWithdrawn).toBe(true);
    expect((await newest(p.id)).state).toBe("withdrawn");
  });

  it("keeps a self grant when the corrected date still makes them an adult on the decision date", async () => {
    const p = await namedPlayer(owner, teamId, { age: 25 });
    await recordConsent(owner, p.id, selfGrant());
    const res = await updatePlayer(owner, p.id, await withDob(p.id, dobYearsAgo(20, 10)));
    expect(res.consentWithdrawn).toBe(false);
    expect((await newest(p.id)).state).toBe("scout_visible");
    expect(jobs.enqueueConsentWithdrawn).not.toHaveBeenCalled();
  });

  it("leaves a guardian's grant alone", async () => {
    const p = await namedPlayer(owner, teamId, { age: 14 });
    await recordConsent(owner, p.id, guardianGrant());
    const res = await updatePlayer(owner, p.id, await withDob(p.id, dobYearsAgo(12, 10)));
    expect(res.consentWithdrawn).toBe(false);
    expect((await newest(p.id)).state).toBe("scout_visible");
  });

  it("leaves consent alone when the date of birth does not change", async () => {
    const p = await namedPlayer(owner, teamId, { age: 19 });
    await recordConsent(owner, p.id, selfGrant());
    const input = { ...(await withDob(p.id, "")), firstName: "Renamed" };
    const dob = (await rawDb.player.findUniqueOrThrow({ where: { id: p.id } })).dateOfBirth!;
    input.dateOfBirth = dob.toISOString().slice(0, 10);
    const res = await updatePlayer(owner, p.id, input);
    expect(res).toMatchObject({ changed: ["firstName"], consentWithdrawn: false });
    expect((await newest(p.id)).state).toBe("scout_visible");
  });
});

describe("recording consent against a date of birth that changed meanwhile", () => {
  it("refuses a self grant decided on a date of birth an edit has since replaced", async () => {
    const p = await namedPlayer(owner, teamId, { age: 19 });
    const stale = (await rawDb.player.findUniqueOrThrow({ where: { id: p.id } })).dateOfBirth;
    await updatePlayer(owner, p.id, await withDob(p.id, dobYearsAgo(14, 10)));
    // The edit lands between recordConsent's read and its lock: the read still
    // sees the adult date of birth, the lock sees the minor's.
    const staleRead = withStalePlayerRead(owner, stale);
    await expect(recordConsent(staleRead, p.id, selfGrant())).rejects.toMatchObject({
      code: "invalid",
      userMessage: DOB_CHANGED_WHILE_RECORDING,
    });
    expect(await rawDb.consent.count({ where: { playerId: p.id } })).toBe(0);
  });
});

/** ctx whose player.findFirst reports `dateOfBirth`; everything else is the real client. */
function withStalePlayerRead(ctx: AuthContext, dateOfBirth: Date | null): AuthContext {
  const bindTo = (target: object) => (t: object, key: string | symbol) => {
    const v = Reflect.get(t, key) as unknown;
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
  };
  const player = new Proxy(ctx.db.player, {
    get(t, key) {
      if (key !== "findFirst") return bindTo(t)(t, key);
      return async (args: Parameters<typeof t.findFirst>[0]) => {
        const row = await t.findFirst(args);
        return row && { ...row, dateOfBirth };
      };
    },
  });
  const db = new Proxy(ctx.db, {
    get: (t, key) => (key === "player" ? player : bindTo(t)(t, key)),
  });
  return { ...ctx, db } as AuthContext;
}
