import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rawDb } from "@/server/db/raw";
import { entitlement, entitlementsFor, hasCapacity, limitFor, may } from "@/server/entitlements";
import { ensureSubscription, PILOT_PLAN_LIMITS } from "@/server/entitlements/plans";
import { fixtures } from "./helpers/fixtures";

// BILL01, BILL02, ADMIN04: entitlement() resolves the plan, then overrides,
// then flags, for one organisation only.

const log = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("@/server/log", () => ({ log }));

const f = fixtures();
let orgA: string;
let orgB: string;
let orgNoPlan: string;

async function setRow(
  organisationId: string,
  key: string,
  source: "override" | "flag",
  value: unknown,
) {
  await rawDb.entitlement.upsert({
    where: { organisationId_key_source: { organisationId, key, source } },
    create: { organisationId, key, source, value: value as never },
    update: { value: value as never },
  });
}

beforeAll(async () => {
  orgA = (await f.org("Entitled A")).id;
  orgB = (await f.org("Entitled B")).id;
  orgNoPlan = (await f.org("No plan")).id;
  await ensureSubscription(rawDb, orgA);
  await ensureSubscription(rawDb, orgB);
});

beforeEach(async () => {
  log.warn.mockReset();
  await rawDb.entitlement.deleteMany({
    where: { organisationId: { in: [orgA, orgB, orgNoPlan] } },
  });
});

afterAll(async () => {
  await f.cleanup();
});

describe("entitlement()", () => {
  it("an organisation on pilot resolves the plan's values", async () => {
    expect(await entitlement(orgA, "matches_per_month")).toBe(PILOT_PLAN_LIMITS.matches_per_month);
    expect(await limitFor(orgA, "upload_max_bytes")).toBe(PILOT_PLAN_LIMITS.upload_max_bytes);
    expect(await may(orgA, "scout_search")).toBe(false);
    const all = await entitlementsFor(orgA);
    expect(all.basis).toBe("subscription");
    expect(all.plan?.code).toBe("pilot");
    expect(all.entitlements.every((e) => e.source === "plan")).toBe(true);
  });

  it("an override, then a flag, change the result in that order", async () => {
    await setRow(orgA, "matches_per_month", "override", 250);
    expect(await entitlement(orgA, "matches_per_month")).toBe(250);
    await setRow(orgA, "matches_per_month", "flag", 3);
    expect(await entitlement(orgA, "matches_per_month")).toBe(3);
    const detail = (await entitlementsFor(orgA)).entitlements.find(
      (e) => e.key === "matches_per_month",
    )!;
    expect(detail).toMatchObject({ value: 3, source: "flag" });
    expect(detail.override?.parsed).toBe(250);
    expect(detail.plan).toEqual({ value: 100, source: "plan", invalid: false });
  });

  it("an unlimited override gives Infinity, and hasCapacity always fits", async () => {
    await setRow(orgA, "scout_seats", "override", "unlimited");
    expect(await limitFor(orgA, "scout_seats")).toBe(Infinity);
    expect(await hasCapacity(orgA, "scout_seats", 1_000_000)).toBe(true);
  });

  it("hasCapacity compares used + adding with the limit", async () => {
    await setRow(orgA, "member_seats", "override", 3);
    expect(await hasCapacity(orgA, "member_seats", 2)).toBe(true);
    expect(await hasCapacity(orgA, "member_seats", 3)).toBe(false);
    expect(await hasCapacity(orgA, "member_seats", 1, 2)).toBe(true);
    expect(await hasCapacity(orgA, "member_seats", 1, 3)).toBe(false);
  });

  it("may() reflects a flag", async () => {
    await setRow(orgA, "share_links", "flag", true);
    expect(await may(orgA, "share_links")).toBe(true);
    await setRow(orgA, "share_links", "flag", false);
    expect(await may(orgA, "share_links")).toBe(false);
  });

  it("an organisation with no subscription falls back to pilot, with a warning", async () => {
    expect(await entitlement(orgNoPlan, "favourited_clips")).toBe(
      PILOT_PLAN_LIMITS.favourited_clips,
    );
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ organisationId: orgNoPlan, basis: "pilot_fallback" }),
      expect.any(String),
    );
    const all = await entitlementsFor(orgNoPlan);
    expect(all.basis).toBe("pilot_fallback");
    expect(all.subscription).toBeNull();
  });

  it("overrides and flags on another organisation never change this one", async () => {
    await setRow(orgB, "matches_per_month", "override", 1);
    await setRow(orgB, "scout_search", "flag", true);
    await setRow(orgB, "upload_max_bytes", "flag", 0);
    expect(await entitlement(orgA, "matches_per_month")).toBe(100);
    expect(await may(orgA, "scout_search")).toBe(false);
    expect(await limitFor(orgA, "upload_max_bytes")).toBe(PILOT_PLAN_LIMITS.upload_max_bytes);
    expect(await may(orgB, "scout_search")).toBe(true);
  });

  it("a malformed stored value falls back to the next layer and is logged", async () => {
    await setRow(orgA, "matches_per_month", "override", "lots");
    await setRow(orgA, "billing", "flag", "yes");
    expect(await entitlement(orgA, "matches_per_month")).toBe(100);
    expect(await may(orgA, "billing")).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        organisationId: orgA,
        key: "matches_per_month",
        layer: "override",
      }),
      "invalid entitlement value ignored",
    );
    const detail = (await entitlementsFor(orgA)).entitlements.find(
      (e) => e.key === "matches_per_month",
    )!;
    expect(detail.override?.parsed).toBeNull();
    expect(detail.source).toBe("plan");
  });
});
