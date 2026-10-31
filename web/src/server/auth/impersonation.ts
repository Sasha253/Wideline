import "server-only";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { deleteSessionCookie, expireCookie, setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { audit } from "../audit";
import { rawDb } from "../db/raw";

/**
 * "Log in as": a platform admin opens a session as another user to see the app
 * through their roles, then returns to their own session. Modelled on Better
 * Auth's admin plugin, whose role check reads a user.role column this app does
 * not have: here the caller must hold platform_admin in the active platform
 * organisation, as for every other platform operation.
 *
 * - Platform admins cannot be impersonated, so one admin never acts as another.
 * - An impersonation session lasts an hour and cannot start another one.
 * - The admin's own session token waits in a signed cookie for the way back.
 * - Start and stop are audited with the admin as actor (the session hook in
 *   ./auth.ts writes the start).
 */

export const IMPERSONATION_SECONDS = 60 * 60;

const ADMIN_COOKIE = "impersonator_session";

/** True when the user holds an accepted platform_admin membership in an active platform organisation. */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const membership = await rawDb.membership.findFirst({
    where: {
      userId,
      role: "platform_admin",
      acceptedAt: { not: null },
      organisation: { type: "platform", status: "active" },
    },
    select: { id: true },
  });
  return membership !== null;
}

export function impersonation() {
  return {
    id: "wideline-impersonation",
    schema: {
      session: {
        fields: { impersonatedBy: { type: "string", required: false, input: false } },
      },
    },
    endpoints: {
      startImpersonation: createAuthEndpoint(
        "/impersonation/start",
        {
          method: "POST",
          body: z.object({ userId: z.string().min(1) }),
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const current = ctx.context.session;
          if (current.session.impersonatedBy) {
            throw new APIError("BAD_REQUEST", { message: "Return to your own account first." });
          }
          if (!(await isPlatformAdmin(current.user.id))) {
            throw new APIError("FORBIDDEN", { message: "Requires platform_admin" });
          }
          if (ctx.body.userId === current.user.id) {
            throw new APIError("BAD_REQUEST", { message: "That is you." });
          }
          const target = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
          if (!target) throw new APIError("NOT_FOUND", { message: "User not found" });
          if (await isPlatformAdmin(target.id)) {
            throw new APIError("FORBIDDEN", { message: "Platform admins cannot be impersonated." });
          }

          const session = await ctx.context.internalAdapter.createSession(
            target.id,
            true,
            {
              impersonatedBy: current.user.id,
              expiresAt: new Date(Date.now() + IMPERSONATION_SECONDS * 1000),
            },
            true,
          );
          if (!session) throw new APIError("INTERNAL_SERVER_ERROR");

          const cookies = ctx.context.authCookies;
          const dontRemember = await ctx.getSignedCookie(
            cookies.dontRememberToken.name,
            ctx.context.secret,
          );
          deleteSessionCookie(ctx);
          await ctx.setSignedCookie(
            ctx.context.createAuthCookie(ADMIN_COOKIE).name,
            `${current.session.token}:${dontRemember ?? ""}`,
            ctx.context.secret,
            cookies.sessionToken.attributes,
          );
          await setSessionCookie(ctx, { session, user: target }, true);
          return ctx.json({ userId: target.id, name: target.name });
        },
      ),

      stopImpersonation: createAuthEndpoint(
        "/impersonation/stop",
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          const current = ctx.context.session;
          const adminId = current.session.impersonatedBy as string | null | undefined;
          if (!adminId) {
            throw new APIError("BAD_REQUEST", { message: "You are not logged in as anyone." });
          }

          const adminCookie = ctx.context.createAuthCookie(ADMIN_COOKIE);
          const stored = await ctx.getSignedCookie(adminCookie.name, ctx.context.secret);
          const [adminToken, dontRemember] = stored ? stored.split(":") : [];
          const adminSession = adminToken
            ? await ctx.context.internalAdapter.findSession(adminToken)
            : null;

          await ctx.context.internalAdapter.deleteSession(current.session.token);
          expireCookie(ctx, adminCookie);
          await audit({
            organisationId: null,
            actorUserId: adminId,
            action: "auth.impersonate.stop",
            targetType: "User",
            targetId: current.user.id,
            metadata: { sessionId: current.session.id },
          });

          // The admin's own session expired or was revoked meanwhile: sign out.
          if (!adminSession || adminSession.session.userId !== adminId) {
            deleteSessionCookie(ctx);
            return ctx.json({ restored: false });
          }
          await setSessionCookie(ctx, adminSession, Boolean(dontRemember));
          return ctx.json({ restored: true });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
