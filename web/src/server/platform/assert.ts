import "server-only";
import { AuthzError, type AuthContext } from "../auth/session";

/**
 * Platform operations re-check the caller here, so one that forgot
 * requireRole(PLATFORM_ROLES) still cannot use them. platform_admin counts only
 * in the Wideline platform organisation.
 */
export function assertPlatformAdmin(ctx: AuthContext): void {
  if (!ctx.roles.includes("platform_admin") || ctx.organisationType !== "platform") {
    throw new AuthzError(403, "Requires platform_admin");
  }
}
