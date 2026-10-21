import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@/generated/prisma/enums";
import { rawDb } from "../db/raw";
import { scopedDb, type ScopedDb } from "../db/scoped";
import { auth } from "./auth";

/**
 * Server-side permission checks (AUTH-06). Every route handler, server action
 * and server-component data read goes through requireRole() or one of its
 * wrappers. The proxy (src/proxy.ts) only redirects signed-out visitors; it is
 * never the permission check.
 */

export const ACTIVE_ORG_COOKIE = "wl_org";

export type AuthContext = {
  user: { id: string; name: string; email: string };
  organisationId: string;
  organisationName: string;
  roles: Role[];
  /** Database client scoped to the active organisation. */
  db: ScopedDb;
};

export class AuthzError extends Error {
  constructor(
    readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "AuthzError";
  }
}

const loadContext = cache(async (): Promise<AuthContext | null> => {
  // Read request headers first: that marks the route dynamic before any env or
  // database access, so `next build` never tries to prerender it.
  const requestHeaders = await headers();
  const session = await auth().api.getSession({ headers: requestHeaders });
  if (!session) return null;

  const memberships = await rawDb.membership.findMany({
    where: {
      userId: session.user.id,
      acceptedAt: { not: null },
      organisation: { status: "active" },
    },
    include: { organisation: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) return null;

  // AUTH-05: a user may belong to several organisations; the active one comes
  // from a cookie, falling back to the oldest membership.
  const wanted = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const active = memberships.find((m) => m.organisationId === wanted) ?? memberships[0]!;
  const organisationId = active.organisationId;

  return {
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    organisationId,
    organisationName: active.organisation.name,
    roles: memberships.filter((m) => m.organisationId === organisationId).map((m) => m.role),
    db: scopedDb(organisationId),
  };
});

/** The signed-in user's context, or null. Does not check any role. */
export async function getAuthContext(): Promise<AuthContext | null> {
  return loadContext();
}

/** Throws AuthzError (401 or 403) unless the user holds one of the roles. */
export async function requireRole(roles: readonly Role[]): Promise<AuthContext> {
  const ctx = await loadContext();
  if (!ctx) throw new AuthzError(401, "Not signed in");
  if (!ctx.roles.some((r) => roles.includes(r))) {
    throw new AuthzError(403, `Requires one of: ${roles.join(", ")}`);
  }
  return ctx;
}

/** For server components and pages: redirects instead of throwing. */
export async function requirePageRole(roles: readonly Role[]): Promise<AuthContext> {
  try {
    return await requireRole(roles);
  } catch (err) {
    if (err instanceof AuthzError) redirect(err.status === 401 ? "/login" : "/forbidden");
    throw err;
  }
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

/** Roles allowed into the CV Lab. Only platform admins in V0. */
export const LAB_ROLES: readonly Role[] = ["platform_admin"];
