import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { OrganisationType, Role } from "@/generated/prisma/enums";
import { safeNextPath } from "@/lib/safe-next";
import { rawDb } from "../db/raw";
import { scopedDb, type ScopedDb } from "../db/scoped";
import { auth } from "./auth";

/**
 * Server-side permission checks (AUTH-06). Every route handler, server action
 * and server-component data read goes through requireRole() or one of its
 * wrappers. The proxy (src/proxy.ts) only redirects signed-out visitors; it is
 * never the permission check.
 */

/** Request header the proxy sets to the requested path, so a redirect to /login can come back. */
export const PATH_HEADER = "x-wl-path";

/** Message of the AuthzError for a signed-in user with no active membership. */
export const NO_ORGANISATION = "No active organisation";

// Display and sort order of roles, as in AUTH-03.
export const ROLE_ORDER: readonly Role[] = [
  "owner",
  "admin",
  "coach",
  "scout",
  "agent",
  "player",
  "guardian",
  "platform_admin",
];

/** One organisation the user belongs to: the data source of the org switcher (D02). */
export type OrganisationSummary = {
  id: string;
  name: string;
  type: OrganisationType;
  country: string;
  region: string | null;
  roles: Role[];
};

type SessionUser = { id: string; name: string; email: string };

type BaseContext = {
  sessionId: string;
  user: SessionUser;
  /** The platform admin behind a "Log in as" session (./impersonation.ts), or null. */
  impersonator: SessionUser | null;
  /** Every active organisation with an accepted membership, sorted by name. */
  organisations: OrganisationSummary[];
};

export type AuthContext = BaseContext & {
  organisationId: string;
  organisationName: string;
  organisationType: OrganisationType;
  /** The user's roles in the active organisation. */
  roles: Role[];
  /** Database client scoped to the active organisation. */
  db: ScopedDb;
};

/** A signed-in user, who may have no active organisation (organisationId null). */
export type UserContext =
  | AuthContext
  | (BaseContext & {
      organisationId: null;
      organisationName: null;
      organisationType: null;
      roles: Role[];
      db: null;
    });

export class AuthzError extends Error {
  constructor(
    readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "AuthzError";
  }
}

/**
 * Builds the context for a session. The active organisation is the session's
 * activeOrganisationId when the user still has an accepted membership in that
 * organisation and it is active; otherwise the oldest such membership (AUTH-05).
 * A stale value (membership removed, organisation suspended) therefore falls
 * back on the next request. Exported for the integration tests.
 */
export async function contextForSession({
  sessionId,
  user,
  activeOrganisationId,
  impersonatedBy,
}: {
  sessionId: string;
  user: SessionUser;
  activeOrganisationId: string | null | undefined;
  impersonatedBy?: string | null;
}): Promise<UserContext> {
  const impersonator = impersonatedBy
    ? await rawDb.user.findUnique({
        where: { id: impersonatedBy },
        select: { id: true, name: true, email: true },
      })
    : null;
  const memberships = await rawDb.membership.findMany({
    where: {
      userId: user.id,
      acceptedAt: { not: null },
      organisation: { status: "active" },
    },
    include: {
      organisation: { select: { id: true, name: true, type: true, country: true, region: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const byOrg = new Map<string, OrganisationSummary>();
  for (const m of memberships) {
    const entry = byOrg.get(m.organisationId) ?? { ...m.organisation, roles: [] };
    // platform_admin only means anything in the Wideline platform organisation.
    // A stray platform_admin membership in a tenant grants nothing.
    if (m.role === "platform_admin" && m.organisation.type !== "platform") continue;
    entry.roles.push(m.role);
    byOrg.set(m.organisationId, entry);
  }
  for (const org of byOrg.values()) {
    org.roles.sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
  }
  const organisations = [...byOrg.values()].sort((a, b) => a.name.localeCompare(b.name, "en-ZA"));
  const base = { sessionId, user, impersonator, organisations };

  const activeId =
    activeOrganisationId && byOrg.has(activeOrganisationId)
      ? activeOrganisationId
      : memberships[0]?.organisationId;
  const active = activeId ? byOrg.get(activeId) : undefined;
  if (!active) {
    return {
      ...base,
      organisationId: null,
      organisationName: null,
      organisationType: null,
      roles: [],
      db: null,
    };
  }

  return {
    ...base,
    organisationId: active.id,
    organisationName: active.name,
    organisationType: active.type,
    roles: active.roles,
    db: scopedDb(active.id),
  };
}

// The Better Auth session for this request only, read once per request.
const loadSession = cache(async () => {
  // Read request headers first: that marks the route dynamic before any env or
  // database access, so `next build` never tries to prerender it.
  const requestHeaders = await headers();
  return auth().api.getSession({ headers: requestHeaders });
});

const loadContext = cache(async (): Promise<UserContext | null> => {
  const session = await loadSession();
  if (!session) return null;
  return contextForSession({
    sessionId: session.session.id,
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    activeOrganisationId: session.session.activeOrganisationId,
    impersonatedBy: session.session.impersonatedBy,
  });
});

/** The signed-in user's context with an active organisation, or null. Checks no role. */
export async function getAuthContext(): Promise<AuthContext | null> {
  const ctx = await loadContext();
  return ctx?.organisationId ? ctx : null;
}

/** The signed-in user's context, with or without an organisation, or null. Checks no role. */
export async function getUserContext(): Promise<UserContext | null> {
  return loadContext();
}

/**
 * Throws AuthzError unless the user holds one of the roles in the active
 * organisation: 401 when signed out, 403 with NO_ORGANISATION when the user
 * has no active membership, otherwise 403.
 */
export async function requireRole(roles: readonly Role[]): Promise<AuthContext> {
  const ctx = await loadContext();
  if (!ctx) throw new AuthzError(401, "Not signed in");
  if (!ctx.organisationId) throw new AuthzError(403, NO_ORGANISATION);
  if (!ctx.roles.some((r) => roles.includes(r))) {
    throw new AuthzError(403, `Requires one of: ${roles.join(", ")}`);
  }
  return ctx;
}

/** Redirects to /login, with next= the requested path when the proxy passed it on. */
export async function loginRedirect(): Promise<never> {
  const path = safeNextPath((await headers()).get(PATH_HEADER), "");
  redirect(path ? `/login?next=${encodeURIComponent(path)}` : "/login");
}

/**
 * For server components and pages: redirects instead of throwing. Signed out
 * goes to /login, no organisation to /organisations, a missing role to /forbidden.
 */
export async function requirePageRole(roles: readonly Role[]): Promise<AuthContext> {
  try {
    return await requireRole(roles);
  } catch (err) {
    if (err instanceof AuthzError) {
      if (err.status === 401) return loginRedirect();
      redirect(err.message === NO_ORGANISATION ? "/organisations" : "/forbidden");
    }
    throw err;
  }
}

/**
 * For pages that only need a signed-in user (/organisations, the app layout).
 * The organisation is optional. Redirects to /login when signed out.
 */
export async function requireUser(): Promise<UserContext> {
  const ctx = await loadContext();
  if (!ctx) return loginRedirect();
  return ctx;
}

type RouteHandler<P> = (req: Request, ctx: AuthContext, params: P) => Promise<Response>;

/** For route handlers: answers 401 or 403 as JSON instead of throwing. */
export function withRole<P = unknown>(roles: readonly Role[], handler: RouteHandler<P>) {
  return async (req: Request, routeCtx: { params: Promise<P> }): Promise<Response> => {
    let ctx: AuthContext;
    try {
      ctx = await requireRole(roles);
    } catch (err) {
      if (err instanceof AuthzError) {
        return Response.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }
    return handler(req, ctx, await routeCtx.params);
  };
}

/** Every role: any member of the active organisation. */
export const ALL_ROLES: readonly Role[] = ROLE_ORDER;

/** Organisation administrators: settings, members and invitations. */
export const ORG_ADMIN_ROLES: readonly Role[] = ["owner", "admin"];

/** Club staff: the dashboard, squad and matches (D02 nav; C04, C06, C14 pages). */
export const CLUB_ROLES: readonly Role[] = ["owner", "admin", "coach"];

/**
 * Squad writes (C04): teams, players, the CSV import, departures and undoing
 * them. Owners, admins and coaches: the user chose to let coaches keep the
 * squad up to date (QUESTIONS.md Q-011). Every write is audited.
 */
export const SQUAD_ADMIN_ROLES: readonly Role[] = ["owner", "admin", "coach"];

/**
 * Consent writes (C05): recording, withdrawing and guardian links. Owners and
 * admins only: the PRD gives consent recording to the club admin, and a wrong
 * grant carries POPIA weight. Coaches read consent states and history. This
 * is an open C05 question (docs/build/QUESTIONS.md, who may record consent).
 */
export const CONSENT_ADMIN_ROLES: readonly Role[] = ["owner", "admin"];

/**
 * Match work (C06): create and edit matches, upload footage, lineups,
 * substitutions and kickoff and half-time markers. Everyone on club staff:
 * coaches upload after the match (docs/build/design/C06.md).
 */
export const MATCH_ROLES: readonly Role[] = CLUB_ROLES;

/**
 * Deleting a match (C06, MATCH08): owners and admins only. It removes the
 * footage, lineups, markers and everything derived from them. An open C06
 * question (docs/build/QUESTIONS.md, Q-026).
 */
export const MATCH_DELETE_ROLES: readonly Role[] = ORG_ADMIN_ROLES;

/**
 * Scouts: the review queue, shortlists and the scout profile (D02 nav; C02,
 * C10, C15 pages). Review pages also need requireReviewer() (auth/reviewer.ts).
 */
export const SCOUT_ROLES: readonly Role[] = ["scout"];

/** Wideline staff: the organisation and scout approval queues (ADMIN01). */
export const PLATFORM_ROLES: readonly Role[] = ["platform_admin"];

/** Roles allowed into the CV Lab. Only platform admins in V0. */
export const LAB_ROLES: readonly Role[] = ["platform_admin"];

/** Roles allowed into the developer pages (/dev), such as the component gallery. */
export const DEV_ROLES: readonly Role[] = ["platform_admin"];
