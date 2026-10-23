import { describe, expect, it } from "vitest";
import type { Role } from "@/generated/prisma/enums";
import {
  homeFor,
  isCurrent,
  NAV_CLUB_ROLES,
  NAV_ITEMS,
  NAV_ORG_ADMIN_ROLES,
  NAV_PLATFORM_ROLES,
  NAV_SCOUT_ROLES,
  navForRoles,
} from "@/lib/nav";
import {
  CLUB_ROLES,
  LAB_ROLES,
  ORG_ADMIN_ROLES,
  PLATFORM_ROLES,
  SCOUT_ROLES,
} from "@/server/auth/session";

// D02 main nav: each role sees only its items. The nav is a convenience; the pages
// call requirePageRole() themselves (tests/unit/page-guards.test.tsx).

const labels = (roles: Role[]) => navForRoles(roles).map((i) => i.label);

describe("navForRoles", () => {
  it.each<Role>(["owner", "admin"])("gives %s the club items and Settings", (role) => {
    expect(labels([role])).toEqual(["Dashboard", "Squad", "Matches", "Settings"]);
  });

  it("gives a coach the club items without Settings", () => {
    expect(labels(["coach"])).toEqual(["Dashboard", "Squad", "Matches"]);
  });

  it("gives a scout the review queue, shortlists and the scout profile (C02)", () => {
    expect(labels(["scout"])).toEqual(["Review queue", "Shortlists", "Scout profile"]);
  });

  it("shows the scout profile item to scouts only", () => {
    const scoutItem = NAV_ITEMS.find((i) => i.id === "scout")!;
    expect(scoutItem).toMatchObject({ href: "/scout", match: "/scout", icon: "BadgeCheck" });
    expect(scoutItem.roles).toEqual(NAV_SCOUT_ROLES);
    for (const role of [
      "owner",
      "admin",
      "coach",
      "agent",
      "player",
      "guardian",
      "platform_admin",
    ] as Role[]) {
      expect(labels([role])).not.toContain("Scout profile");
    }
  });

  it("gives a platform admin Admin and Lab", () => {
    expect(labels(["platform_admin"])).toEqual(["Admin", "Lab"]);
  });

  it("gives several roles the deduplicated union, in NAV_ITEMS order", () => {
    expect(labels(["scout", "owner", "admin"])).toEqual([
      "Dashboard",
      "Squad",
      "Matches",
      "Settings",
      "Review queue",
      "Shortlists",
      "Scout profile",
    ]);
  });

  it.each<Role[]>([["agent"], ["player"], ["guardian"], []])("gives %j nothing", (...roles) => {
    expect(navForRoles(roles)).toEqual([]);
  });

  it("never uses the icons the design system reserves", () => {
    for (const item of NAV_ITEMS) {
      expect(item.icon).not.toMatch(/star|shield|flag/i);
    }
  });
});

describe("homeFor", () => {
  it.each<[Role[], string]>([
    [["platform_admin"], "/lab/matches"],
    [["owner"], "/dashboard"],
    [["admin"], "/dashboard"],
    [["coach"], "/dashboard"],
    [["scout"], "/review"],
    [["coach", "scout"], "/dashboard"],
    [["agent"], "/organisations"],
    [["player"], "/organisations"],
    [["guardian"], "/organisations"],
    [[], "/organisations"],
  ])("sends %j to %s", (roles, home) => {
    expect(homeFor(roles)).toBe(home);
  });

  it("sends every role to a page its nav offers, or to /organisations", () => {
    for (const role of ["owner", "admin", "coach", "scout", "platform_admin"] as Role[]) {
      const hrefs = navForRoles([role]).map((i) => i.href);
      expect(hrefs).toContain(homeFor([role]));
    }
  });
});

describe("isCurrent", () => {
  const item = (id: string) => NAV_ITEMS.find((i) => i.id === id)!;

  it("matches the prefix and anything below it", () => {
    expect(isCurrent("/settings/members", item("settings"))).toBe(true);
    expect(isCurrent("/settings", item("settings"))).toBe(true);
    expect(isCurrent("/lab/matches", item("lab"))).toBe(true);
  });

  it("does not match a longer word with the same start", () => {
    expect(isCurrent("/labx", item("lab"))).toBe(false);
    expect(isCurrent("/matches-old", item("matches"))).toBe(false);
  });

  it("does not match pages without a nav item", () => {
    for (const path of ["/organisations", "/forbidden", "/dev/templates"]) {
      expect(NAV_ITEMS.some((i) => isCurrent(path, i))).toBe(false);
    }
  });
});

describe("nav role sets", () => {
  it("mirror the session.ts constants", () => {
    expect(NAV_CLUB_ROLES).toEqual(CLUB_ROLES);
    expect(NAV_ORG_ADMIN_ROLES).toEqual(ORG_ADMIN_ROLES);
    expect(NAV_SCOUT_ROLES).toEqual(SCOUT_ROLES);
    expect(NAV_PLATFORM_ROLES).toEqual(PLATFORM_ROLES);
    expect(NAV_PLATFORM_ROLES).toEqual(LAB_ROLES);
  });

  it("are the role sets the destination pages check", () => {
    const roles = (id: string) => NAV_ITEMS.find((i) => i.id === id)!.roles;
    expect(roles("dashboard")).toBe(NAV_CLUB_ROLES);
    expect(roles("squad")).toBe(NAV_CLUB_ROLES);
    expect(roles("matches")).toBe(NAV_CLUB_ROLES);
    expect(roles("settings")).toBe(NAV_ORG_ADMIN_ROLES);
    expect(roles("review")).toBe(NAV_SCOUT_ROLES);
    expect(roles("shortlists")).toBe(NAV_SCOUT_ROLES);
    expect(roles("admin")).toBe(NAV_PLATFORM_ROLES);
    expect(roles("lab")).toBe(NAV_PLATFORM_ROLES);
  });
});
