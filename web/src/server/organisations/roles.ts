import type { Role } from "@/generated/prisma/enums";

/**
 * Role-assignment rules (AUTH-03, AUTH-04). Pure, so the unit tests and the
 * pages share them.
 *
 * - platform_admin is never assignable; only the seed grants it.
 * - An owner may grant every organisation role, owner included.
 * - An admin may grant every organisation role except owner, and cannot
 *   change or remove an owner.
 * - An organisation always keeps at least one owner.
 */

/** Organisation roles in display order. platform_admin is not one of them. */
export const ORG_ROLES: readonly Role[] = [
  "owner",
  "admin",
  "coach",
  "scout",
  "agent",
  "player",
  "guardian",
];

export type RoleRuleCode = "not_assignable" | "owner_only" | "last_owner";

export class RoleRuleError extends Error {
  constructor(readonly code: RoleRuleCode) {
    super(`Role rule: ${code}`);
    this.name = "RoleRuleError";
  }
}

/** The roles this actor may give through an invitation or a role change. */
export function assignableRoles(actorRoles: readonly Role[]): Role[] {
  if (actorRoles.includes("owner")) return [...ORG_ROLES];
  if (actorRoles.includes("admin")) return ORG_ROLES.filter((r) => r !== "owner");
  return [];
}

/** Whether this actor may change or remove a membership that holds targetRole. */
export function canManageMembership(actorRoles: readonly Role[], targetRole: Role): boolean {
  if (targetRole === "platform_admin") return false;
  if (actorRoles.includes("owner")) return true;
  if (actorRoles.includes("admin")) return targetRole !== "owner";
  return false;
}

/**
 * Throws RoleRuleError("last_owner") when removing or demoting this
 * membership would leave the organisation with no owner. newRole is the role
 * after a change; leave it out for a removal.
 */
export function assertNotLastOwner({
  targetRole,
  ownerCount,
  newRole,
}: {
  targetRole: Role;
  ownerCount: number;
  newRole?: Role;
}): void {
  if (targetRole !== "owner" || newRole === "owner") return;
  if (ownerCount <= 1) throw new RoleRuleError("last_owner");
}
