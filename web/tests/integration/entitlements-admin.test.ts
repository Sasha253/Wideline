import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rawDb } from "@/server/db/raw";
import { AuthzError, type AuthContext } from "@/server/auth/session";
import { ensureSubscription } from "@/server/entitlements/plans";
import {
  clearLimitOverride,
  EntitlementAdminError,
  getOrganisationEntitlements,
  setFeatureFlag,
  setLimitOverride,
} from "@/server/platform/entitlements";
import { fixtures } from "./helpers/fixtures";

// ADMIN04, BILL01: platform admins set flags and limit overrides per
// organisation. Each change and its audit row commit together (NFR20).

// The audit insert fails on demand, to prove a change rolls back with it.
const failAudit = vi.hoisted(() => ({ on: false }));
vi.mock("@/server/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/audit")>();
  return {
    ...actual,
    audit: vi.fn(async (...args: Parameters<typeof actual.audit>) => {
      if (failAudit.on) throw new Error("audit insert failed");
      return actual.audit(...args);
    }),
  };
});

const f = fixtures();
let admin: AuthContext;
let clubOwner: AuthContext;
let strayAdmin: AuthContext;
let org: string;

const audits = (action?: string) =>
  rawDb.auditLog.findMany({
    where: { organisationId: org, ...(action && { action }) },
    orderBy: { createdAt: "asc" },
  });
const rows = () => rawDb.entitlement.findMany({ where: { organisationId: org } });

beforeAll(async () => {
  const platform = await f.org("Platform", { type: "platform" });
  const adminUser = await f.user("Flags Admin");
  await f.member(platform.id, adminUser.id, "platform_admin");
  admin = await f.ctx(adminUser, platform.id);

  const club = await f.org("Flag club");
  org = club.id;
  await ensureSubscription(rawDb, org);
  const owner = await f.user("Flag Owner");
  await f.member(org, owner.id, "owner");
  clubOwner = await f.ctx(owner, org);

  // platform_admin outside the platform organisation counts for nothing.
  const other = await f.org("Other club");
  const stray = await f.user("Stray Admin");
  await f.member(other.id, stray.id, "owner");
  await f.member(other.id, stray.id, "platform_admin");
  strayAdmin = { ...(await f.ctx(stray, other.id)), roles: ["owner", "platform_admin"] };
});

beforeEach(async () => {
  failAudit.on = false;
  await rawDb.entitlement.deleteMany({ where: { organisationId: org } });
  await rawDb.auditLog.deleteMany({ where: { organisationId: org } });
});

afterAll(async () => {
  await f.cleanup();
});

describe("permissions", () => {
  it.each([
    ["a club owner", () => clubOwner],
    ["platform_admin outside the platform organisation", () => strayAdmin],
  ])("refuses %s with 403", async (_name, ctx) => {
    const calls = [
      () => setFeatureFlag(ctx(), org, "scout_search", "on"),
      () => setLimitOverride(ctx(), org, "matches_per_month", 5),
      () => clearLimitOverride(ctx(), org, "matches_per_month"),
      () => getOrganisationEntitlements(ctx(), org),
    ];
    for (const call of calls) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AuthzError);
      expect((err as AuthzError).status).toBe(403);
    }
    expect(await rows()).toEqual([]);
  });
});

describe("setFeatureFlag", () => {
  it("sets, changes and clears a flag, with one audit row each", async () => {
    const on = await setFeatureFlag(admin, org, "scout_search", "on", "  Pilot scouts  ");
    expect(on.changed).toBe(true);
    expect(on.entitlement).toMatchObject({ value: true, source: "flag" });
    expect(on.planName).toBe("Pilot");
    let [row] = await rows();
    expect(row).toMatchObject({
      key: "scout_search",
      source: "flag",
      value: true,
      reason: "Pilot scouts",
      setByUserId: admin.user.id,
    });

    await setFeatureFlag(admin, org, "scout_search", "off");
    [row] = await rows();
    expect(row?.value).toBe(false);

    const cleared = await setFeatureFlag(admin, org, "scout_search", "default", "Back to plan");
    expect(cleared.changed).toBe(true);
    expect(cleared.entitlement).toMatchObject({ value: false, source: "plan" });
    expect(await rows()).toEqual([]);

    const log = await audits();
    expect(log.map((a) => [a.action, a.metadata])).toEqual([
      [
        "entitlement.flag_set",
        { key: "scout_search", from: "default", to: "on", reason: "Pilot scouts" },
      ],
      ["entitlement.flag_set", { key: "scout_search", from: "on", to: "off", reason: null }],
      [
        "entitlement.flag_cleared",
        { key: "scout_search", from: "off", to: "default", reason: "Back to plan" },
      ],
    ]);
    expect(log.every((a) => a.actorUserId === admin.user.id)).toBe(true);
  });

  it("writes nothing for an unchanged state", async () => {
    expect((await setFeatureFlag(admin, org, "billing", "default")).changed).toBe(false);
    await setFeatureFlag(admin, org, "billing", "on");
    const before = await rows();
    const again = await setFeatureFlag(admin, org, "billing", "on", "different reason");
    expect(again.changed).toBe(false);
    expect(await rows()).toEqual(before);
    expect(await audits()).toHaveLength(1);
  });

  it("replaces an invalid stored flag", async () => {
    await rawDb.entitlement.create({
      data: { organisationId: org, key: "share_links", source: "flag", value: "yes" },
    });
    const res = await setFeatureFlag(admin, org, "share_links", "off");
    expect(res.changed).toBe(true);
    expect((await rows())[0]?.value).toBe(false);
    expect((await audits())[0]?.metadata).toMatchObject({ from: "invalid", to: "off" });
  });

  it("rolls back the flag when the audit insert fails", async () => {
    failAudit.on = true;
    await expect(setFeatureFlag(admin, org, "scout_reports", "on")).rejects.toThrow(
      "audit insert failed",
    );
    expect(await rows()).toEqual([]);
    failAudit.on = false;
    await setFeatureFlag(admin, org, "scout_reports", "on");
    failAudit.on = true;
    await expect(setFeatureFlag(admin, org, "scout_reports", "default")).rejects.toThrow();
    expect((await rows()).map((r) => r.value)).toEqual([true]);
    expect(await audits()).toHaveLength(1);
  });

  it("rejects an unknown key, a limit key, and a reason over 500 characters", async () => {
    for (const key of ["no_such_key", "matches_per_month"]) {
      const err = await setFeatureFlag(admin, org, key, "on").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EntitlementAdminError);
      expect((err as EntitlementAdminError).code).toBe("unknown_key");
    }
    await expect(setFeatureFlag(admin, org, "billing", "on", "x".repeat(501))).rejects.toThrow();
    expect(await rows()).toEqual([]);
  });
});

describe("setLimitOverride and clearLimitOverride", () => {
  it("sets, changes and clears an override, with one audit row each", async () => {
    const set = await setLimitOverride(admin, org, "matches_per_month", 250, "Trial club");
    expect(set.entitlement).toMatchObject({ value: 250, source: "override" });
    const unlimited = await setLimitOverride(admin, org, "matches_per_month", "unlimited");
    expect(unlimited.entitlement.value).toBe(Infinity);
    expect((await rows())[0]).toMatchObject({ source: "override", value: "unlimited" });

    const cleared = await clearLimitOverride(admin, org, "matches_per_month", "Trial over");
    expect(cleared.changed).toBe(true);
    expect(cleared.entitlement).toMatchObject({ value: 100, source: "plan" });
    expect(await rows()).toEqual([]);

    expect((await audits()).map((a) => [a.action, a.metadata])).toEqual([
      [
        "entitlement.override_set",
        { key: "matches_per_month", from: null, to: 250, reason: "Trial club" },
      ],
      [
        "entitlement.override_set",
        { key: "matches_per_month", from: 250, to: "unlimited", reason: null },
      ],
      [
        "entitlement.override_cleared",
        { key: "matches_per_month", from: "unlimited", to: null, reason: "Trial over" },
      ],
    ]);
  });

  it("writes nothing for the same value, or a clear with no override", async () => {
    expect((await clearLimitOverride(admin, org, "scout_seats")).changed).toBe(false);
    await setLimitOverride(admin, org, "scout_seats", 7);
    expect((await setLimitOverride(admin, org, "scout_seats", 7)).changed).toBe(false);
    expect(await audits()).toHaveLength(1);
  });

  it("rolls back the override when the audit insert fails", async () => {
    failAudit.on = true;
    await expect(setLimitOverride(admin, org, "member_seats", 3)).rejects.toThrow();
    expect(await rows()).toEqual([]);
    failAudit.on = false;
    await setLimitOverride(admin, org, "member_seats", 3);
    failAudit.on = true;
    await expect(clearLimitOverride(admin, org, "member_seats")).rejects.toThrow();
    expect((await rows()).map((r) => r.value)).toEqual([3]);
    expect(await audits()).toHaveLength(1);
  });

  it("rejects an unknown key, a feature key, and invalid values", async () => {
    for (const call of [
      () => setLimitOverride(admin, org, "no_such_key", 5),
      () => setLimitOverride(admin, org, "billing", 1),
      () => clearLimitOverride(admin, org, "scout_search"),
    ]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EntitlementAdminError);
      expect((err as EntitlementAdminError).code).toBe("unknown_key");
    }
    for (const bad of [-1, 1.5, Infinity, "lots"]) {
      await expect(
        setLimitOverride(admin, org, "matches_per_month", bad as never),
      ).rejects.toThrow();
    }
    expect(await rows()).toEqual([]);
  });
});

describe("unknown organisation", () => {
  it("throws not_found and writes nothing", async () => {
    for (const call of [
      () => getOrganisationEntitlements(admin, "no-such-org"),
      () => setFeatureFlag(admin, "no-such-org", "billing", "on"),
      () => setLimitOverride(admin, "no-such-org", "scout_seats", 1),
      () => clearLimitOverride(admin, "no-such-org", "scout_seats"),
    ]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EntitlementAdminError);
      expect((err as EntitlementAdminError).code).toBe("not_found");
    }
  });
});

describe("getOrganisationEntitlements", () => {
  it("returns the organisation, its plan and who set each row", async () => {
    await setFeatureFlag(admin, org, "scout_search", "on", "Asked by the coach");
    const view = await getOrganisationEntitlements(admin, org);
    expect(view.organisation.id).toBe(org);
    expect(view.plan?.name).toBe("Pilot");
    expect(view.entitlements).toHaveLength(9);
    const flag = view.entitlements.find((e) => e.key === "scout_search")!;
    expect(flag.flagInfo).toMatchObject({ reason: "Asked by the coach", setByName: "Flags Admin" });
    expect(flag.overrideInfo).toBeNull();
  });
});
