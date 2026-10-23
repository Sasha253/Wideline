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

// /review needs review access, not only the scout role (C02, review-guards.test.ts).
const requireReviewerPage = vi.fn();
vi.mock("@/server/auth/reviewer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/reviewer")>()),
  requireReviewerPage,
}));

const session =
  await vi.importActual<typeof import("@/server/auth/session")>("@/server/auth/session");

type Page = (props: { children?: ReactNode }) => Promise<ReactNode>;

const PAGES: [string, () => Promise<{ default: unknown }>, readonly Role[]][] = [
  ["/dashboard", () => import("@/app/(app)/dashboard/page"), session.CLUB_ROLES],
  ["/squad", () => import("@/app/(app)/squad/page"), session.CLUB_ROLES],
  ["/matches", () => import("@/app/(app)/matches/page"), session.CLUB_ROLES],
  ["/scout", () => import("@/app/(app)/scout/page"), session.SCOUT_ROLES],
  ["/shortlists", () => import("@/app/(app)/shortlists/page"), session.SCOUT_ROLES],
  ["/settings", () => import("@/app/(app)/settings/page"), session.ORG_ADMIN_ROLES],
  ["/admin", () => import("@/app/(app)/admin/page"), session.PLATFORM_ROLES],
  ["/admin/scouts", () => import("@/app/(app)/admin/scouts/page"), session.PLATFORM_ROLES],
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
      page({ children: null, searchParams: Promise.resolve({}) } as never),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(requirePageRole).toHaveBeenCalledTimes(1);
    expect(requirePageRole).toHaveBeenCalledWith(roles);
  });
});

describe("placeholder pages for an allowed role", () => {
  it.each([
    ["/dashboard", () => import("@/app/(app)/dashboard/page"), "Nothing to show yet"],
    ["/squad", () => import("@/app/(app)/squad/page"), "No players yet"],
    ["/matches", () => import("@/app/(app)/matches/page"), "No matches yet"],
    ["/shortlists", () => import("@/app/(app)/shortlists/page"), "No shortlists yet"],
  ])("%s renders one h1 and its empty state", async (_name, load, empty) => {
    requirePageRole.mockResolvedValue({ organisationName: "Wideline Demo FC" });
    const page = (await load()).default as Page;
    const html = renderToStaticMarkup(await page({}));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(empty);
    expect(html).not.toContain("undefined");
  });

  it("/review checks review access first, then renders one h1 and its empty state", async () => {
    requireReviewerPage.mockImplementationOnce(async () => {
      throw new Error("NEXT_REDIRECT");
    });
    const page = (await import("@/app/(app)/review/page")).default as Page;
    await expect(page({})).rejects.toThrow("NEXT_REDIRECT");
    expect(requirePageRole).not.toHaveBeenCalled();
    requireReviewerPage.mockResolvedValueOnce({ organisationName: "Wideline scouts" });
    const html = renderToStaticMarkup(await page({}));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("No matches waiting");
  });

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
});
