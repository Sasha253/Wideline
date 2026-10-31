import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/generated/prisma/enums";

// AUTH06 for the D02 pages: each one calls requirePageRole with its role set before it
// renders anything, so the nav is never the only gate. Pattern of dev-gallery-access.test.tsx.

const requirePageRole = vi.fn();
vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  requirePageRole,
}));

// /review and /shortlists need review access, not only the scout role (C02,
// review-guards.test.ts).
const requireReviewerPage = vi.fn();
vi.mock("@/server/auth/reviewer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/reviewer")>()),
  requireReviewerPage,
}));

// The squad list reads teams once the role check passes (C04).
vi.mock("@/server/squad/teams", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/squad/teams")>()),
  listTeams: vi.fn(async () => ({ own: [], opposition: [] })),
}));

// The match list reads its matches once the role check passes (C06).
vi.mock("@/server/matches/matches", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/matches/matches")>()),
  listMatchesByStatus: vi.fn(async () => []),
}));

// The review queue reads the queue once review access passes (C10).
vi.mock("@/server/review/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/review/queue")>()),
  reviewQueue: vi.fn(async () => ({
    mine: [],
    waiting: [],
    clipsOnly: [],
    claimLimit: 1,
    activeClaims: 0,
    atLimit: false,
    capped: false,
  })),
}));

const session =
  await vi.importActual<typeof import("@/server/auth/session")>("@/server/auth/session");

type Page = (props: { children?: ReactNode }) => Promise<ReactNode>;

const PAGES: [string, () => Promise<{ default: unknown }>, readonly Role[]][] = [
  ["/dashboard", () => import("@/app/(app)/dashboard/page"), session.CLUB_ROLES],
  ["/squad", () => import("@/app/(app)/squad/page"), session.CLUB_ROLES],
  // C04: every squad page reads with CLUB_ROLES; writes are checked in the actions.
  ["/squad/teams", () => import("@/app/(app)/squad/teams/page"), session.CLUB_ROLES],
  ["/squad/teams/new", () => import("@/app/(app)/squad/teams/new/page"), session.CLUB_ROLES],
  [
    "/squad/teams/[teamId]",
    () => import("@/app/(app)/squad/teams/[teamId]/page"),
    session.CLUB_ROLES,
  ],
  ["/squad/players/new", () => import("@/app/(app)/squad/players/new/page"), session.CLUB_ROLES],
  [
    "/squad/players/[playerId]",
    () => import("@/app/(app)/squad/players/[playerId]/page"),
    session.CLUB_ROLES,
  ],
  ["/squad/import", () => import("@/app/(app)/squad/import/page"), session.CLUB_ROLES],
  // C05: the consent pages read with CLUB_ROLES (coaches see a note, not the
  // form); the actions check CONSENT_ADMIN_ROLES.
  [
    "/squad/players/[playerId]/consent",
    () => import("@/app/(app)/squad/players/[playerId]/consent/page"),
    session.CLUB_ROLES,
  ],
  [
    "/squad/players/[playerId]/consent/print",
    () => import("@/app/(app)/squad/players/[playerId]/consent/print/page"),
    session.CLUB_ROLES,
  ],
  ["/matches", () => import("@/app/(app)/matches/page"), session.CLUB_ROLES],
  // C06: every match page reads with CLUB_ROLES; the actions and route handlers
  // check MATCH_ROLES and MATCH_DELETE_ROLES (match-guards.test.ts).
  ["/matches/new", () => import("@/app/(app)/matches/new/page"), session.CLUB_ROLES],
  ["/matches/[matchId]", () => import("@/app/(app)/matches/[matchId]/page"), session.CLUB_ROLES],
  [
    "/matches/[matchId]/edit",
    () => import("@/app/(app)/matches/[matchId]/edit/page"),
    session.CLUB_ROLES,
  ],
  [
    "/matches/[matchId]/upload",
    () => import("@/app/(app)/matches/[matchId]/upload/page"),
    session.CLUB_ROLES,
  ],
  [
    "/matches/[matchId]/lineup",
    () => import("@/app/(app)/matches/[matchId]/lineup/page"),
    session.CLUB_ROLES,
  ],
  [
    "/matches/[matchId]/markers",
    () => import("@/app/(app)/matches/[matchId]/markers/page"),
    session.CLUB_ROLES,
  ],
  ["/scout", () => import("@/app/(app)/scout/page"), session.SCOUT_ROLES],
  ["/settings", () => import("@/app/(app)/settings/page"), session.ORG_ADMIN_ROLES],
  ["/admin", () => import("@/app/(app)/admin/page"), session.PLATFORM_ROLES],
  ["/admin/scouts", () => import("@/app/(app)/admin/scouts/page"), session.PLATFORM_ROLES],
  [
    "/admin/organisations/[organisationId]",
    () => import("@/app/(app)/admin/organisations/[organisationId]/page"),
    session.PLATFORM_ROLES,
  ],
  ["/dev/templates", () => import("@/app/(app)/dev/templates/page"), session.DEV_ROLES],
  ["/dev/templates/list", () => import("@/app/(app)/dev/templates/list/page"), session.DEV_ROLES],
  [
    "/dev/templates/detail",
    () => import("@/app/(app)/dev/templates/detail/page"),
    session.DEV_ROLES,
  ],
  [
    "/dev/templates/workspace",
    () => import("@/app/(app)/dev/templates/workspace/page"),
    session.DEV_ROLES,
  ],
  [
    "/dev/templates/decision",
    () => import("@/app/(app)/dev/templates/decision/page"),
    session.DEV_ROLES,
  ],
  [
    "/dev/templates/states",
    () => import("@/app/(app)/dev/templates/states/page"),
    session.DEV_ROLES,
  ],
  ["Lab layout", () => import("@/app/(app)/lab/layout"), session.LAB_ROLES],
  ["/lab", () => import("@/app/(app)/lab/page"), session.LAB_ROLES],
  // C09: the Lab's benchmark, match benchmark and calibration pages.
  ["/lab/matches", () => import("@/app/(app)/lab/matches/page"), session.LAB_ROLES],
  [
    "/lab/matches/[matchId]",
    () => import("@/app/(app)/lab/matches/[matchId]/page"),
    session.LAB_ROLES,
  ],
  [
    "/lab/matches/[matchId]/calibration",
    () => import("@/app/(app)/lab/matches/[matchId]/calibration/page"),
    session.LAB_ROLES,
  ],
  ["/lab/benchmark", () => import("@/app/(app)/lab/benchmark/page"), session.LAB_ROLES],
];

beforeEach(() => {
  requirePageRole.mockReset();
  requireReviewerPage.mockReset();
});

describe.each(PAGES)("%s", (_name, load, roles) => {
  it("checks its role set before rendering", async () => {
    requirePageRole.mockImplementation(async () => {
      throw new Error("NEXT_REDIRECT");
    });
    const page = (await load()).default as Page;
    await expect(
      page({
        children: null,
        searchParams: Promise.resolve({}),
        params: Promise.resolve({
          organisationId: "org-1",
          teamId: "t-1",
          playerId: "p-1",
          matchId: "m-1",
        }),
      } as never),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(requirePageRole).toHaveBeenCalledTimes(1);
    expect(requirePageRole).toHaveBeenCalledWith(roles);
  });
});

describe("placeholder pages for an allowed role", () => {
  it.each([
    ["/dashboard", () => import("@/app/(app)/dashboard/page"), "Nothing to show yet"],
    ["/squad", () => import("@/app/(app)/squad/page"), "No teams yet"],
    // C06: with no teams, the match list asks for a team first.
    ["/matches", () => import("@/app/(app)/matches/page"), "Add a team first"],
  ])("%s renders one h1 and its empty state", async (_name, load, empty) => {
    requirePageRole.mockResolvedValue({
      organisationName: "Wideline Demo FC",
      organisationType: "club",
      roles: ["coach"],
    });
    const page = (await load()).default as Page;
    const html = renderToStaticMarkup(await page({ searchParams: Promise.resolve({}) } as never));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(empty);
    expect(html).not.toContain("undefined");
  });

  it.each([
    ["/review", () => import("@/app/(app)/review/page"), "No matches waiting"],
    ["/shortlists", () => import("@/app/(app)/shortlists/page"), "No shortlists yet"],
  ])(
    "%s checks review access first, then renders one h1 and its empty state",
    async (_name, load, empty) => {
      requireReviewerPage.mockImplementationOnce(async () => {
        throw new Error("NEXT_REDIRECT");
      });
      // The queue reads ?done= (C10); the shortlists placeholder ignores it.
      const page = (await load()).default as (props: {
        searchParams: Promise<Record<string, string>>;
      }) => Promise<ReactNode>;
      const props = { searchParams: Promise.resolve({}) };
      await expect(page(props)).rejects.toThrow("NEXT_REDIRECT");
      expect(requireReviewerPage).toHaveBeenCalledTimes(1);
      expect(requirePageRole).not.toHaveBeenCalled();
      requireReviewerPage.mockResolvedValueOnce({ organisationName: "Wideline scouts" });
      const html = renderToStaticMarkup(await page(props));
      expect(html.match(/<h1/g)).toHaveLength(1);
      expect(html).toContain(empty);
    },
  );

  it("/dashboard names the active organisation", async () => {
    requirePageRole.mockResolvedValue({ organisationName: "Wideline Demo FC" });
    const page = (await import("@/app/(app)/dashboard/page")).default as Page;
    expect(renderToStaticMarkup(await page({}))).toContain("Wideline Demo FC at a glance.");
  });

  it.each([
    ["/settings", () => import("@/app/(app)/settings/page"), "/settings/organisation"],
    ["/admin", () => import("@/app/(app)/admin/page"), "/admin/organisations"],
  ])("%s redirects to its first page", async (_name, load, target) => {
    requirePageRole.mockResolvedValue({});
    const page = (await load()).default as Page;
    const err = await page({}).catch((e: unknown) => e);
    expect(String((err as { digest?: string }).digest)).toContain(target);
  });
});

describe("role constants", () => {
  it("CLUB_ROLES and SCOUT_ROLES are the D02 sets", () => {
    expect(session.CLUB_ROLES).toEqual(["owner", "admin", "coach"]);
    expect(session.SCOUT_ROLES).toEqual(["scout"]);
  });

  it("SQUAD_ADMIN_ROLES is owners, admins and coaches (C04, Q-011)", () => {
    expect(session.SQUAD_ADMIN_ROLES).toEqual(["owner", "admin", "coach"]);
  });

  it("MATCH_ROLES is club staff and MATCH_DELETE_ROLES owners and admins (C06)", () => {
    expect(session.MATCH_ROLES).toEqual(["owner", "admin", "coach"]);
    expect(session.MATCH_DELETE_ROLES).toEqual(["owner", "admin"]);
    expect(session.MATCH_DELETE_ROLES).not.toContain("coach");
  });

  it("CONSENT_ADMIN_ROLES is owners and admins: coaches read consent only (C05)", () => {
    expect(session.CONSENT_ADMIN_ROLES).toEqual(["owner", "admin"]);
    expect(session.CONSENT_ADMIN_ROLES).not.toContain("coach");
    expect(session.CONSENT_ADMIN_ROLES).not.toContain("scout");
    expect(session.CONSENT_ADMIN_ROLES).not.toContain("guardian");
  });
});
