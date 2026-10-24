import "server-only";
import type { MatchStatus, Role } from "@/generated/prisma/enums";
import { MATCH_DELETE_ROLES } from "../auth/session";
import { MatchError } from "./errors";

/**
 * Access rules for matches (C06). Matches are for academies and clubs only, so
 * every service function calls requireSquadOrg() first, as the squad does
 * (src/server/squad/access.ts). Page and action role checks use MATCH_ROLES and
 * MATCH_DELETE_ROLES (src/server/auth/session.ts).
 */
export { requireSquadOrg, requireSquadOrgPage } from "../squad/access";

/** Lineups and markers lock once a scout reviews the match, and stay locked once published. */
export const LOCKED_STATUSES: readonly MatchStatus[] = ["in_review", "published"];

export function isLocked(status: MatchStatus): status is "in_review" | "published" {
  return LOCKED_STATUSES.includes(status);
}

/** Throws MatchError("locked") for a match in review or published. */
export function assertMatchEditable(status: MatchStatus, message?: string): void {
  if (isLocked(status)) throw new MatchError("locked", message);
}

/** Owners and admins delete matches; the action checks this again. */
export function canDeleteMatch(roles: readonly Role[]): boolean {
  return roles.some((r) => MATCH_DELETE_ROLES.includes(r));
}
