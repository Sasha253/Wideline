import "server-only";
import { redirect } from "next/navigation";
import type { ScoutStatus } from "@/generated/prisma/enums";
import { rawDb } from "../db/raw";
import { REVIEWER_TERMS_VERSION } from "../scouts/terms";
import {
  AuthzError,
  loginRedirect,
  NO_ORGANISATION,
  requireRole,
  SCOUT_ROLES,
  type AuthContext,
} from "./session";

/**
 * Review access (AUTH09, ADMIN06). On top of the scout role, a reviewer needs
 * an approved ScoutProfile that accepted the current REVIEWER_TERMS_VERSION.
 * The profile is read on every call, so a suspension or a new terms version
 * takes effect on the very next request. Every review page, route handler and
 * server action uses requireReviewer(), requireReviewerPage() or withReviewer(),
 * never requireRole(SCOUT_ROLES) alone (tests/unit/review-guards.test.ts).
 */

/** Paths that need review access. The guard test checks every page and route under them. */
export const REVIEW_ROUTE_PREFIXES = ["/review", "/api/review"] as const;

export const REVIEWER_DENIED = [
  "SCOUT_NOT_REGISTERED",
  "SCOUT_PENDING",
  "SCOUT_REJECTED",
  "SCOUT_SUSPENDED",
  "SCOUT_TERMS_REQUIRED",
] as const;
export type ReviewerDenied = (typeof REVIEWER_DENIED)[number];

export type ReviewerScout = {
  id: string;
  status: ScoutStatus;
  termsVersion: string;
};

export type ReviewerContext = AuthContext & { scout: ReviewerScout };

const STATUS_CODE: Record<Exclude<ScoutStatus, "approved">, ReviewerDenied> = {
  pending: "SCOUT_PENDING",
  rejected: "SCOUT_REJECTED",
  suspended: "SCOUT_SUSPENDED",
};

/** True for the AuthzError of a scout who exists but may not review yet. */
export function isReviewerDenied(err: unknown): boolean {
  return err instanceof AuthzError && (REVIEWER_DENIED as readonly string[]).includes(err.message);
}

/**
 * Throws AuthzError unless the user may review: 401 signed out, 403 without the
 * scout role in the active organisation, and 403 with a ReviewerDenied message
 * for no profile, a status other than approved, or stale terms.
 */
export async function requireReviewer(): Promise<ReviewerContext> {
  const ctx = await requireRole(SCOUT_ROLES);
  const scout = await rawDb.scoutProfile.findUnique({
    where: { userId: ctx.user.id },
    select: { id: true, status: true, termsVersion: true },
  });
  if (!scout) throw new AuthzError(403, "SCOUT_NOT_REGISTERED");
  if (scout.status !== "approved") throw new AuthzError(403, STATUS_CODE[scout.status]);
  if (scout.termsVersion !== REVIEWER_TERMS_VERSION) {
    throw new AuthzError(403, "SCOUT_TERMS_REQUIRED");
  }
  return { ...ctx, scout };
}

/**
 * For review pages: a scout who may not review yet goes to /scout (which says
 * why), a missing role to /forbidden, no organisation to /organisations, and a
 * signed-out visitor to /login.
 */
export async function requireReviewerPage(): Promise<ReviewerContext> {
  try {
    return await requireReviewer();
  } catch (err) {
    if (err instanceof AuthzError) {
      if (err.status === 401) return loginRedirect();
      if (isReviewerDenied(err)) redirect("/scout?from=review");
      redirect(err.message === NO_ORGANISATION ? "/organisations" : "/forbidden");
    }
    throw err;
  }
}

type RouteHandler<P> = (req: Request, ctx: ReviewerContext, params: P) => Promise<Response>;

/** For review route handlers: answers 401 or 403 as JSON instead of throwing. */
export function withReviewer<P = unknown>(handler: RouteHandler<P>) {
  return async (req: Request, routeCtx: { params: Promise<P> }): Promise<Response> => {
    let ctx: ReviewerContext;
    try {
      ctx = await requireReviewer();
    } catch (err) {
      if (err instanceof AuthzError) {
        return Response.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }
    return handler(req, ctx, await routeCtx.params);
  };
}
