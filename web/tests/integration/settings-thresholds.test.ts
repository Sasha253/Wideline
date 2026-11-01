import { afterAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/server/auth/session";

// C11 (REVIEW10, Q-069, Q-070): owners and admins save the auto-accept
// thresholds; a coach's post is refused by the action. The values round-trip
// through autoAcceptThresholds(), other settings keys are kept, the
// organisation.thresholds_changed audit row holds the old and new values, and
// a scout-network organisation is refused.

let current: AuthContext | null = null;

vi.mock("@/server/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/session")>();
  return {
    ...actual,
    requireRole: async (roles: readonly string[]) => {
      if (!current) throw new actual.AuthzError(401, "Not signed in");
      if (!current.roles.some((r) => roles.includes(r))) {
        throw new actual.AuthzError(403, `Requires one of: ${roles.join(", ")}`);
      }
      return current;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { rawDb } = await import("@/server/db/raw");
const { autoAcceptThresholds } = await import("@/lib/auto-accept");
const { updateAutoAcceptThresholds } = await import("@/server/organisations/settings");
const { saveThresholdsAction } = await import("@/app/(app)/settings/review/actions");
const { fixtures } = await import("./helpers/fixtures");
const { SCOUT_NETWORK_ORG_ID } = await import("@/server/scouts/network");

const f = fixtures();

afterAll(async () => {
  await f.cleanup();
});

async function staff(orgId: string, role: "owner" | "admin" | "coach" | "scout") {
  const u = await f.user(`Thresholds ${role} ${orgId.slice(-8)}`);
  await f.member(orgId, u.id, role);
  return f.ctx(u, orgId);
}

const form = (goal: string, shot: string, touch: string) => {
  const fd = new FormData();
  fd.set("goal", goal);
  fd.set("shot", shot);
  fd.set("touch", touch);
  return fd;
};

describe("review threshold settings", { timeout: 60_000 }, () => {
  it("owners and admins save; values round-trip and other keys stay", async () => {
    const org = await f.org("Thresholds FC");
    await rawDb.organisation.update({
      where: { id: org.id },
      data: { settings: { other: { keep: true } } },
    });
    current = await staff(org.id, "admin");
    const result = await saveThresholdsAction(null, form("0.95", "0.6", ".7"));
    expect(result).toMatchObject({ ok: true, message: "Thresholds saved." });
    const saved = await rawDb.organisation.findUniqueOrThrow({ where: { id: org.id } });
    expect(saved.settings).toEqual({
      other: { keep: true },
      autoAccept: { goal: 0.95, shot: 0.6, touch: 0.7 },
    });
    expect(autoAcceptThresholds(saved.settings)).toEqual({ goal: 0.95, shot: 0.6, touch: 0.7 });

    const [row] = await rawDb.auditLog.findMany({
      where: { organisationId: org.id, action: "organisation.thresholds_changed" },
    });
    expect(row).toMatchObject({ actorUserId: current.user.id, targetId: org.id });
    expect(row?.metadata).toEqual({
      from: { goal: 0.9, shot: 0.75, touch: 0.8 },
      to: { goal: 0.95, shot: 0.6, touch: 0.7 },
    });

    current = await staff(org.id, "owner");
    expect((await saveThresholdsAction(null, form("0.95", "0.6", "0.70")))?.ok).toBe(true);
    // No change: no second audit row.
    expect(
      await rawDb.auditLog.count({
        where: { organisationId: org.id, action: "organisation.thresholds_changed" },
      }),
    ).toBe(1);
  });

  it("returns field errors for values that are not scores", async () => {
    const org = await f.org("Thresholds errors");
    current = await staff(org.id, "owner");
    const result = await saveThresholdsAction(null, form("1.5", "0.75", "abc"));
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        goal: "Enter a number from 0.00 to 1.00.",
        touch: "Enter a number from 0.00 to 1.00.",
      },
    });
  });

  it("refuses a coach's post", async () => {
    const org = await f.org("Thresholds coach");
    current = await staff(org.id, "coach");
    expect(await saveThresholdsAction(null, form("0.5", "0.5", "0.5"))).toEqual({
      ok: false,
      formError: "Only owners and admins can change review settings.",
    });
    const saved = await rawDb.organisation.findUniqueOrThrow({ where: { id: org.id } });
    expect(saved.settings).toEqual({});
  });

  it("refuses an organisation without matches (scout network)", async () => {
    const ctx = await staff(SCOUT_NETWORK_ORG_ID, "scout");
    const err = await updateAutoAcceptThresholds(
      { ...ctx, roles: ["owner"] },
      { goal: "0.5", shot: "0.5", touch: "0.5" },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/academies and clubs/);
  });
});
