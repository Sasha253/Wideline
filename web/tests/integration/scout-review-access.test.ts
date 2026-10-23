import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserContext } from "@/server/auth/session";

// C02 acceptance (AUTH09, ADMIN06): an unapproved or suspended scout gets 403 on
// every review route. requireReviewer reads the profile on every call, so a
// suspension applies to the very next request. The request's session is
// replaced by a fixture context (contextForSession, as a real request builds it).

let current: UserContext | null = null;

vi.mock("@/server/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/session")>();
  return {
    ...actual,
    // The real role check, on the fixture context instead of the request's session.
    requireRole: async (roles: readonly string[]) => {
      if (!current) throw new actual.AuthzError(401, "Not signed in");
      if (!current.organisationId) throw new actual.AuthzError(403, actual.NO_ORGANISATION);
      if (!current.roles.some((r) => roles.includes(r))) {
        throw new actual.AuthzError(403, `Requires one of: ${roles.join(", ")}`);
      }
      return current;
    },
  };
});

const sendMail = vi.hoisted(() => vi.fn());
vi.mock("@/server/mail", () => ({ sendMail }));

const { rawDb } = await import("@/server/db/raw");
const { contextForSession, AuthzError } = await import("@/server/auth/session");
const { requireReviewer, withReviewer } = await import("@/server/auth/reviewer");
const { suspendScout, reinstateScout } = await import("@/server/platform/scouts");
const { ensureScoutNetwork, SCOUT_NETWORK_ORG_ID } = await import("@/server/scouts/network");
const { REVIEWER_TERMS_VERSION } = await import("@/server/scouts/terms");
const { fixtures } = await import("./helpers/fixtures");
const { scoutProfile } = await import("./helpers/scouts");

const f = fixtures();

async function as(user: { id: string; name: string; email: string }, orgId: string | null = null) {
  current = await contextForSession({ sessionId: "s", user, activeOrganisationId: orgId });
}

async function scoutWith(
  label: string,
  opts: Parameters<typeof scoutProfile>[1] | null,
): Promise<{ id: string; name: string; email: string }> {
  const u = await f.user(`Scout ${label}`);
  if (opts) await scoutProfile(u.id, opts);
  else {
    // A scout role (in the network) but no profile, like a club-invited scout.
    await f.member(SCOUT_NETWORK_ORG_ID, u.id, "scout");
  }
  return u;
}

const handler = withReviewer(async () => Response.json({ ok: true }));
const call = () =>
  handler(new Request("http://test/api/review/x"), { params: Promise.resolve({}) });

let platformAdmin: Awaited<ReturnType<typeof f.ctx>>;

beforeAll(async () => {
  await ensureScoutNetwork();
  const platform = await f.org("Platform", { type: "platform" });
  const admin = await f.user("Platform Admin");
  await f.member(platform.id, admin.id, "platform_admin");
  platformAdmin = await f.ctx(admin, platform.id);
});

beforeEach(() => {
  current = null;
  sendMail.mockReset();
});

afterAll(async () => {
  await f.cleanup();
});

describe("requireReviewer", () => {
  it.each<[string, Parameters<typeof scoutProfile>[1] | null, string]>([
    ["no profile", null, "SCOUT_NOT_REGISTERED"],
    ["pending", { status: "pending" }, "SCOUT_PENDING"],
    ["rejected", { status: "rejected" }, "SCOUT_REJECTED"],
    ["suspended", { status: "suspended" }, "SCOUT_SUSPENDED"],
    ["stale terms", { status: "approved", termsVersion: "2025-01-old" }, "SCOUT_TERMS_REQUIRED"],
    ["missing terms", { status: "approved", termsVersion: "" }, "SCOUT_TERMS_REQUIRED"],
  ])("refuses a scout with %s (403 %s), in code and as JSON", async (label, opts, code) => {
    await as(await scoutWith(label, opts));
    await expect(requireReviewer()).rejects.toMatchObject({ status: 403, message: code });
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: code });
  });

  it("refuses a user without the scout role, even with an approved profile", async () => {
    const club = await f.org("Club");
    const coach = await f.user("Coach with profile");
    await f.member(club.id, coach.id, "coach");
    await scoutProfile(coach.id, { status: "approved", membership: false });
    await as(coach, club.id);
    const err = await requireReviewer().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthzError);
    expect(err).toMatchObject({ status: 403, message: "Requires one of: scout" });
    expect((await call()).status).toBe(403);
  });

  it("answers 401 when signed out", async () => {
    await expect(requireReviewer()).rejects.toMatchObject({ status: 401 });
    expect((await call()).status).toBe(401);
  });

  it("lets an approved scout on the current terms review", async () => {
    const u = await scoutWith("approved", { status: "approved" });
    await as(u);
    const ctx = await requireReviewer();
    expect(ctx.organisationId).toBe(SCOUT_NETWORK_ORG_ID);
    expect(ctx.scout).toMatchObject({ status: "approved", termsVersion: REVIEWER_TERMS_VERSION });
    const res = await call();
    expect(res.status).toBe(200);
  });

  it("cuts access on the very next call after a suspension, and restores it on reinstatement", async () => {
    const u = await scoutWith("to suspend", { status: "approved" });
    await as(u);
    await expect(requireReviewer()).resolves.toBeTruthy();
    const profile = await rawDb.scoutProfile.findUniqueOrThrow({ where: { userId: u.id } });

    await suspendScout(platformAdmin, profile.id, "Shared footage outside Wideline");
    await expect(requireReviewer()).rejects.toMatchObject({
      status: 403,
      message: "SCOUT_SUSPENDED",
    });
    expect((await call()).status).toBe(403);

    await reinstateScout(platformAdmin, profile.id);
    await expect(requireReviewer()).resolves.toBeTruthy();
  });
});
