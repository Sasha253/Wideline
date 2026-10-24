import "server-only";
import { redirect } from "next/navigation";
import type { OrganisationType } from "@/generated/prisma/enums";
import { AuthzError, type AuthContext } from "../auth/session";

/**
 * Squad data (teams, named players, the CSV import) belongs to clubs and
 * academies only. An agency, the scout network or the platform organisation
 * never holds a squad, whatever its members' roles, so their owners and admins
 * cannot create teams or import named minors in their own tenant.
 */
export const SQUAD_ORG_TYPES: readonly OrganisationType[] = ["academy", "club"];

/** Message of the AuthzError for an organisation type without a squad. */
export const SQUAD_ORG_REQUIRED = "Squad data is for academies and clubs only";

export function isSquadOrg(type: OrganisationType | null | undefined): boolean {
  return !!type && SQUAD_ORG_TYPES.includes(type);
}

/**
 * Throws AuthzError 403 unless the active organisation is an academy or a
 * club. Every squad service function calls it first; actions call it right
 * after requireRole(). Returns the context, so it chains.
 */
export function requireSquadOrg<T extends Pick<AuthContext, "organisationType">>(ctx: T): T {
  if (!isSquadOrg(ctx.organisationType)) throw new AuthzError(403, SQUAD_ORG_REQUIRED);
  return ctx;
}

/** For squad pages, after requirePageRole(): another organisation type goes to /forbidden. */
export function requireSquadOrgPage<T extends Pick<AuthContext, "organisationType">>(ctx: T): T {
  if (!isSquadOrg(ctx.organisationType)) redirect("/forbidden");
  return ctx;
}
