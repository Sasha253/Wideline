import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { todayIso } from "@/lib/squad-fields";
import type { AuthContext } from "@/server/auth/session";
import { rawDb } from "@/server/db/raw";
import {
  ConsentError,
  consentHistory,
  currentConsent,
  recordConsent,
  withdrawConsent,
} from "@/server/consent/records";
import { CONSENT_WORDING_VERSION } from "@/server/consent/wording";
import { addPlaceholders, markDeparted } from "@/server/squad/players";
import { createTeam } from "@/server/squad/teams";
import { dobYearsAgo, guardianGrant, namedPlayer } from "./helpers/consent";
import { fixtures } from "./helpers/fixtures";

// CONS01, CONS02, NFR09, NFR10, NFR20 (docs/build/design/C05.md, Surfaces 2 and 4).

const jobs = vi.hoisted(() => ({ enqueueConsentWithdrawn: vi.fn(async () => {}) }));
vi.mock("@/server/consent/jobs", () => jobs);

// Lets one test make the audit write fail, to prove it shares the transaction.
const auditSwitch = vi.hoisted(() => ({ fail: false }));
vi.mock("@/server/audit", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/audit")>();
  return {
    ...mod,
    audit: async (...args: Parameters<typeof mod.audit>) => {
      if (auditSwitch.fail) throw new Error("audit down");
      return mod.audit(...args);
    },
  };
});

const f = fixtures();
let ctx: AuthContext;
let orgId: string;
let teamId: string;
let oppositionId: string;

beforeAll(async () => {
  const org = await f.org("Consent records FC");
  orgId = org.id;
  const owner = await f.user("Consent Owner");
  await f.member(org.id, owner.id, "owner");
  ctx = await f.ctx(owner, org.id);
  teamId = (await createTeam(ctx, { name: "U15 Girls", season: "2026" })).id;
  oppositionId = (await createTeam(ctx, { name: "Rivals", season: "2026" }, "opposition")).id;
});

afterAll(async () => {
  await f.cleanup();
});

beforeEach(() => {
  jobs.enqueueConsentWithdrawn.mockClear();
  auditSwitch.fail = false;
});

const errorOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e as Error,
  );

async function cache(playerId: string) {
  return (await rawDb.player.findUniqueOrThrow({ where: { id: playerId } })).consentState;
}

async function newestState(playerId: string) {
  const row = await rawDb.consent.findFirst({
    where: { playerId },
    orderBy: { createdAt: "desc" },
  });
  return row?.state ?? "none";
}

describe("under-18 guardian rule (CONS02)", () => {
  it("refuses a 14-year-old's record without a guardian name, in the service", async () => {
    const p = await namedPlayer(ctx, teamId, { age: 14 });
    const err = await errorOf(recordConsent(ctx, p.id, guardianGrant({ grantedBy: "" })));
    expect(err).toBeInstanceOf(ZodError);
    expect((err as ZodError).issues.map((i) => i.path[0])).toEqual(["grantedBy"]);
    expect(await rawDb.consent.count({ where: { playerId: p.id } })).toBe(0);
  });

  it("refuses 'self' for a minor in the service", async () => {
    const p = await namedPlayer(ctx, teamId, { age: 14 });
    const err = await errorOf(recordConsent(ctx, p.id, guardianGrant({ relationship: "self" })));
    expect((err as ConsentError).field).toBe("relationship");
  });

  it("refuses a raw minor grant without a guardian (CHECK Consent_minor_needs_guardian)", async () => {
    const p = await namedPlayer(ctx, teamId, { age: 14 });
    const err = await errorOf(
      rawDb.consent.create({
        data: {
          organisationId: orgId,
          playerId: p.id,
          state: "club_only",
          clubStats: true,
          scoutVisible: false,
          grantedBy: "Lebo",
          relationship: "self",
          method: "in_person",
          wordingVersion: CONSENT_WORDING_VERSION,
          playerWasMinor: true,
          grantedAt: new Date(),
        },
      }),
    );
    expect(String(err)).toContain("Consent_minor_needs_guardian");
    expect(await cache(p.id)).toBe("none");
  });

  it("refuses a raw grant with no method or wording version (CHECK Consent_grant_complete)", async () => {
    const p = await namedPlayer(ctx, teamId, { age: 14 });
    const err = await errorOf(
      rawDb.consent.create({
        data: {
          organisationId: orgId,
          playerId: p.id,
          state: "club_only",
          clubStats: true,
          scoutVisible: false,
          grantedBy: "Thandi",
          relationship: "parent",
          playerWasMinor: true,
          grantedAt: new Date(),
        },
      }),
    );
    expect(String(err)).toContain("Consent_grant_complete");
  });

  it("records a guardian's grant with every NFR09 field and the wording version", async () => {
    const p = await namedPlayer(ctx, teamId, { age: 14 });
    const res = await recordConsent(ctx, p.id, guardianGrant());
    expect(res.state).toBe("scout_visible");
    const row = await rawDb.consent.findUniqueOrThrow({ where: { id: res.consentId } });
    expect(row).toMatchObject({
      grantedBy: "Thandi Mokoena",
      relationship: "parent",
      method: "paper_form",
      wordingVersion: CONSENT_WORDING_VERSION,
      playerWasMinor: true,
      recordedById: ctx.user.id,
      clubStats: true,
      scoutVisible: true,
    });
    expect(row.grantedAt?.toISOString().slice(0, 10)).toBe(todayIso());
    expect(await cache(p.id)).toBe("scout_visible");
  });

  it("counts a player with no date of birth as a minor", async () => {
    const p = await namedPlayer(ctx, teamId, { age: 14 });
    await rawDb.player.update({ where: { id: p.id }, data: { dateOfBirth: null } });
    const err = await errorOf(recordConsent(ctx, p.id, guardianGrant({ relationship: "self" })));
    expect((err as ConsentError).field).toBe("relationship");
    const ok = await recordConsent(ctx, p.id, guardianGrant({ scoutVisible: "no" }));
    expect(ok.state).toBe("club_only");
  });
});

describe("adults decide for themselves", () => {
  it("records an adult's own consent with their own name and 'self'", async () => {
    const p = await namedPlayer(ctx, teamId, { age: 19, firstName: "Sipho" });
    const res = await recordConsent(ctx, p.id, {
      relationship: "self",
      method: "in_person",
      grantedAt: todayIso(),
      clubStats: "yes",
      scoutVisible: "no",
      seenWording: "on",
    });
    const row = await rawDb.consent.findUniqueOrThrow({ where: { id: res.consentId } });
    expect(row.grantedBy).toBe(p.name);
    expect(row.relationship).toBe("self");
    expect(row.playerWasMinor).toBe(false);
    expect(row.state).toBe("club_only");
  });

  it("refuses an adult's own consent dated when they were under 18", async () => {
    const p = await namedPlayer(ctx, teamId, { age: 18, firstName: "Sipho" });
    const err = await errorOf(
      recordConsent(ctx, p.id, {
        relationship: "self",
        method: "in_person",
        grantedAt: dobYearsAgo(1),
        clubStats: "yes",
        scoutVisible: "no",
        seenWording: "on",
      }),
    );
    expect((err as ConsentError).field).toBe("grantedAt");
  });
});

describe("the two choices (NFR10)", () => {
  it("refuses scouts yes with club no in the service", async () => {
    const p = await namedPlayer(ctx, teamId);
    const err = await errorOf(
      recordConsent(ctx, p.id, guardianGrant({ clubStats: "no", scoutVisible: "yes" })),
    );
    expect(err).toBeInstanceOf(ZodError);
    expect((err as ZodError).issues[0]!.path).toEqual(["scoutVisible"]);
  });

  it("refuses scouts yes with club no in the database (CHECK)", async () => {
    const p = await namedPlayer(ctx, teamId);
    const err = await errorOf(
      rawDb.consent.create({
        data: {
          organisationId: orgId,
          playerId: p.id,
          state: "none",
          clubStats: false,
          scoutVisible: true,
          playerWasMinor: true,
        },
      }),
    );
    expect(String(err)).toMatch(/Consent_(scout_needs_club|state_matches_choices)/);
  });

  it("refuses a state that does not match the choices (CHECK Consent_state_matches_choices)", async () => {
    const p = await namedPlayer(ctx, teamId);
    const err = await errorOf(
      rawDb.consent.create({
        data: {
          organisationId: orgId,
          playerId: p.id,
          state: "requested",
          clubStats: true,
          scoutVisible: false,
          playerWasMinor: true,
        },
      }),
    );
    expect(String(err)).toContain("Consent_state_matches_choices");
  });

  it("records a first refusal as none, and a no after a grant as withdrawn", async () => {
    const p = await namedPlayer(ctx, teamId);
    const refusal = await recordConsent(
      ctx,
      p.id,
      guardianGrant({ clubStats: "no", scoutVisible: "no" }),
    );
    expect(refusal.state).toBe("none");
    expect(jobs.enqueueConsentWithdrawn).not.toHaveBeenCalled();
    await recordConsent(ctx, p.id, guardianGrant({ scoutVisible: "no" }));
    const no = await recordConsent(
      ctx,
      p.id,
      guardianGrant({ clubStats: "no", scoutVisible: "no" }),
    );
    expect(no.state).toBe("withdrawn");
    const row = await rawDb.consent.findUniqueOrThrow({ where: { id: no.consentId } });
    expect(row.withdrawnAt).not.toBeNull();
    expect(jobs.enqueueConsentWithdrawn).toHaveBeenCalledTimes(1);
  });

  it("refuses a future decision date", async () => {
    const p = await namedPlayer(ctx, teamId);
    const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const err = await errorOf(recordConsent(ctx, p.id, guardianGrant({ grantedAt: tomorrow })));
    expect((err as ZodError).issues[0]!.path).toEqual(["grantedAt"]);
  });
});

describe("the cache follows the newest row (CONS01)", () => {
  it("equals the newest row after every insert, including two in quick succession", async () => {
    const p = await namedPlayer(ctx, teamId);
    const steps = [
      guardianGrant({ scoutVisible: "no" }),
      guardianGrant(),
      guardianGrant({ scoutVisible: "no" }),
      guardianGrant(),
    ];
    for (const input of steps) {
      await recordConsent(ctx, p.id, input);
      expect(await cache(p.id)).toBe(await newestState(p.id));
    }
    // Two rows in one transaction: clock_timestamp() still orders them.
    await rawDb.$transaction([
      rawDb.consent.create({
        data: {
          organisationId: orgId,
          playerId: p.id,
          state: "withdrawn",
          clubStats: false,
          scoutVisible: false,
          playerWasMinor: true,
          withdrawnAt: new Date(),
        },
      }),
      rawDb.consent.create({
        data: {
          organisationId: orgId,
          playerId: p.id,
          state: "requested",
          clubStats: false,
          scoutVisible: false,
          playerWasMinor: true,
        },
      }),
    ]);
    expect(await cache(p.id)).toBe("requested");
    expect(await newestState(p.id)).toBe("requested");
    const current = await currentConsent(ctx, p.id);
    expect(current.state).toBe("requested");
  });

  it("serialises concurrent changes to one player", async () => {
    const p = await namedPlayer(ctx, teamId);
    await Promise.all([
      recordConsent(ctx, p.id, guardianGrant()),
      recordConsent(ctx, p.id, guardianGrant({ scoutVisible: "no" })),
      recordConsent(ctx, p.id, guardianGrant()),
    ]);
    expect(await cache(p.id)).toBe(await newestState(p.id));
  });
});

describe("who can hold consent", () => {
  it("refuses a placeholder and an opposition player, in the service and the trigger", async () => {
    await addPlaceholders(ctx, oppositionId, [9]);
    const ph = await rawDb.player.findFirstOrThrow({
      where: { organisationId: orgId, teamId: oppositionId, squadNumber: 9 },
    });
    const err = await errorOf(recordConsent(ctx, ph.id, guardianGrant()));
    expect((err as ConsentError).code).toBe("placeholder");
    const raw = await errorOf(
      rawDb.consent.create({
        data: {
          organisationId: orgId,
          playerId: ph.id,
          state: "requested",
          clubStats: false,
          scoutVisible: false,
          playerWasMinor: true,
        },
      }),
    );
    expect(String(raw)).toContain("placeholder or opposition");
  });

  it("refuses to record new consent for a departed player, but lets the club withdraw", async () => {
    const p = await namedPlayer(ctx, teamId);
    await recordConsent(ctx, p.id, guardianGrant());
    await markDeparted(ctx, p.id);
    const err = await errorOf(recordConsent(ctx, p.id, guardianGrant()));
    expect((err as ConsentError).code).toBe("departed");
    const res = await withdrawConsent(ctx, p.id, {
      requestedBy: "Thandi Mokoena",
      relationship: "parent",
      method: "in_person",
    });
    expect(res.from).toBe("scout_visible");
    expect(await cache(p.id)).toBe("withdrawn");
    expect(jobs.enqueueConsentWithdrawn).toHaveBeenCalledWith({
      organisationId: orgId,
      playerId: p.id,
      consentId: res.consentId,
    });
  });

  it("refuses to withdraw twice", async () => {
    const p = await namedPlayer(ctx, teamId);
    await recordConsent(ctx, p.id, guardianGrant());
    await withdrawConsent(ctx, p.id, { requestedBy: "Thandi", method: "email" });
    const err = await errorOf(
      withdrawConsent(ctx, p.id, { requestedBy: "Thandi", method: "email" }),
    );
    expect((err as ConsentError).code).toBe("not_granted");
  });
});

describe("audit (AUTH07, NFR20)", () => {
  it("writes exactly one audit row per change, with no names in the metadata", async () => {
    const p = await namedPlayer(ctx, teamId, { firstName: "Naledi" });
    const before = await rawDb.auditLog.count({ where: { targetId: p.id } });
    const granted = await recordConsent(ctx, p.id, guardianGrant());
    const downgraded = await recordConsent(ctx, p.id, guardianGrant({ scoutVisible: "no" }));
    const withdrawn = await withdrawConsent(ctx, p.id, {
      requestedBy: "Thandi Mokoena",
      method: "email",
    });
    const rows = await rawDb.auditLog.findMany({
      where: { targetId: p.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.length - before).toBe(3);
    expect(rows.map((r) => r.action)).toEqual([
      "player.create",
      "consent.record",
      "consent.record",
      "consent.withdraw",
    ]);
    expect(rows[2]!.metadata).toMatchObject({
      consentId: downgraded.consentId,
      from: "scout_visible",
      to: "club_only",
    });
    expect(rows[1]!.metadata).toMatchObject({ consentId: granted.consentId, to: "scout_visible" });
    expect(rows[3]!.metadata).toMatchObject({ consentId: withdrawn.consentId, to: "withdrawn" });
    const text = JSON.stringify(rows.map((r) => r.metadata));
    expect(text).not.toContain("Thandi");
    expect(text).not.toContain("Mokoena");
    expect(text).not.toContain("Naledi");
    // The downgrade took scout visibility away, so the purge job ran.
    expect(jobs.enqueueConsentWithdrawn).toHaveBeenCalledTimes(2);
  });

  it("rolls the consent row back when the audit write fails", async () => {
    const p = await namedPlayer(ctx, teamId);
    auditSwitch.fail = true;
    const err = await errorOf(recordConsent(ctx, p.id, guardianGrant()));
    expect(String(err)).toContain("audit down");
    expect(await rawDb.consent.count({ where: { playerId: p.id } })).toBe(0);
    expect(await cache(p.id)).toBe("none");
  });
});

describe("history", () => {
  it("lists every row newest first, with the recording user's name", async () => {
    const p = await namedPlayer(ctx, teamId);
    await recordConsent(ctx, p.id, guardianGrant({ scoutVisible: "no" }));
    await recordConsent(ctx, p.id, guardianGrant());
    const rows = await consentHistory(ctx, p.id);
    expect(rows.map((r) => r.state)).toEqual(["scout_visible", "club_only"]);
    expect(rows[0]!.recordedByName).toBe("Consent Owner");
  });
});
