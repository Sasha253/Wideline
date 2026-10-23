import type { Role } from "@/generated/prisma/enums";

// The main nav and the role home pages (docs/build/design/D02.md, Surface 2).
// Client-safe: it imports only the Role type. The nav is a convenience; every
// page still calls requirePageRole() (AUTH06). A new top-level page adds its
// item here with the matching role constant from src/server/auth/session.ts.

/** Lucide icon names the shell maps to components (NavLinks.tsx). */
export type NavIcon =
  | "LayoutDashboard"
  | "Users"
  | "Video"
  | "Settings"
  | "ListChecks"
  | "Bookmark"
  | "Wrench"
  | "FlaskConical";

export type NavItem = {
  id: string;
  href: string;
  label: string;
  icon: NavIcon;
  /** Path prefix that makes the item current (aria-current="page"). */
  match: string;
  /** Roles that see the item. Mirrors the session.ts constants (tests/unit/nav.test.ts). */
  roles: readonly Role[];
};

// Mirrors of CLUB_ROLES, ORG_ADMIN_ROLES, SCOUT_ROLES and PLATFORM_ROLES / LAB_ROLES
// in session.ts, which is server-only. A unit test keeps them equal.
export const NAV_CLUB_ROLES: readonly Role[] = ["owner", "admin", "coach"];
export const NAV_ORG_ADMIN_ROLES: readonly Role[] = ["owner", "admin"];
export const NAV_SCOUT_ROLES: readonly Role[] = ["scout"];
export const NAV_PLATFORM_ROLES: readonly Role[] = ["platform_admin"];

/** Every nav item, in display order. */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: "dashboard",
    href: "/dashboard",
    label: "Dashboard",
    icon: "LayoutDashboard",
    match: "/dashboard",
    roles: NAV_CLUB_ROLES,
  },
  {
    id: "squad",
    href: "/squad",
    label: "Squad",
    icon: "Users",
    match: "/squad",
    roles: NAV_CLUB_ROLES,
  },
  {
    id: "matches",
    href: "/matches",
    label: "Matches",
    icon: "Video",
    match: "/matches",
    roles: NAV_CLUB_ROLES,
  },
  {
    id: "settings",
    href: "/settings/organisation",
    label: "Settings",
    icon: "Settings",
    match: "/settings",
    roles: NAV_ORG_ADMIN_ROLES,
  },
  {
    id: "review",
    href: "/review",
    label: "Review queue",
    icon: "ListChecks",
    match: "/review",
    roles: NAV_SCOUT_ROLES,
  },
  {
    id: "shortlists",
    href: "/shortlists",
    label: "Shortlists",
    icon: "Bookmark",
    match: "/shortlists",
    roles: NAV_SCOUT_ROLES,
  },
  {
    id: "admin",
    href: "/admin/organisations",
    label: "Admin",
    icon: "Wrench",
    match: "/admin",
    roles: NAV_PLATFORM_ROLES,
  },
  {
    id: "lab",
    href: "/lab/matches",
    label: "Lab",
    icon: "FlaskConical",
    match: "/lab",
    roles: NAV_PLATFORM_ROLES,
  },
];

/** The items the roles can use: the deduplicated union, in NAV_ITEMS order. */
export function navForRoles(roles: readonly Role[]): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.some((r) => roles.includes(r)));
}

/**
 * Where the root sends a user with these roles in the active organisation.
 * Several roles take the first match in this order.
 */
export function homeFor(roles: readonly Role[]): string {
  if (roles.includes("platform_admin")) return "/lab/matches";
  if (roles.some((r) => NAV_CLUB_ROLES.includes(r))) return "/dashboard";
  if (roles.some((r) => NAV_SCOUT_ROLES.includes(r))) return "/review";
  return "/organisations";
}

/** True when the path is the item's match prefix, or below it ("/labx" is not "/lab"). */
export function isCurrent(pathname: string, item: Pick<NavItem, "match">): boolean {
  return pathname === item.match || pathname.startsWith(`${item.match}/`);
}
