import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { scoutProfile } from "./helpers/scouts";
import { fixtures } from "./helpers/fixtures";

// C04 (AUTH06, NFR08): squad data is per-player data held by the club. A scout
// (scout network membership) never reaches it: /squad and /squad/players/[id]
// send them to /forbidden, and the CSV template answers 403. A coach reads.
// The real session code runs; only the Better Auth session lookup is replaced.

let current: { userId: string; name: string; email: string; activeOrganisationId: string | null };

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/auth/auth", () => ({
  auth: () => ({
    api: {
      getSession: async () => ({
        session: { id: "s-1", activeOrganisationId: current.activeOrganisationId },
        user: { id: current.userId, name: current.name, email: current.email },
      }),
    },
  }),
}));

const { CLUB_ROLES, requireRole, AuthzError } = await import("@/server/auth/session");
const { GET: template } = await import("@/app/(app)/squad/import/template/route");

const f = fixtures();
let orgId: string;

beforeAll(async () => {
  const org = await f.org("Squad access FC");
  orgId = org.id;
});

afterAll(async () => {
  await f.cleanup();
});

const asUser = (u: { id: string; name: string; email: string }, org: string | null) => {
  current = { userId: u.id, name: u.name, email: u.email, activeOrganisationId: org };
};

const redirectOf = (p: Promise<unknown>) =>
  p.then(
    () => "rendered",
    (e: unknown) => String((e as { digest?: string }).digest ?? e),
  );

const route = { params: Promise.resolve({}) };

describe("a scout", () => {
  it("is sent to /forbidden from the squad pages, and the template answers 403", async () => {
    const scout = await f.user("Squad Scout");
    await scoutProfile(scout.id, { status: "approved" });
    asUser(scout, null);

    const err = await requireRole(CLUB_ROLES).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthzError);
    expect((err as InstanceType<typeof AuthzError>).status).toBe(403);

    const squad = (await import("@/app/(app)/squad/page")).default;
    expect(await redirectOf(squad({ searchParams: Promise.resolve({}) }))).toContain("/forbidden");
    const player = (await import("@/app/(app)/squad/players/[playerId]/page")).default;
    expect(await redirectOf(player({ params: Promise.resolve({ playerId: "any" }) }))).toContain(
      "/forbidden",
    );

    const res = await template(new Request("http://test/squad/import/template"), route);
    expect(res.status).toBe(403);
  });
});

describe("a coach", () => {
  it("downloads the template", async () => {
    const coach = await f.user("Squad Coach");
    await f.member(orgId, coach.id, "coach");
    asUser(coach, orgId);
    const res = await template(new Request("http://test/squad/import/template"), route);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toContain("wideline-squad-template.csv");
    expect(await res.text()).toBe(
      "First name,Last name,Date of birth,Position,Preferred foot,Height,Squad number\r\nThabo,Nkosi,14/03/2011,RW,Left,165,7\r\n",
    );
  });
});
