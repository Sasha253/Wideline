import "server-only";
import type { Role } from "@/generated/prisma/enums";
import { ROLE_ORDER, type AuthContext } from "../auth/session";
import { audit } from "../audit";
import { assertNotLastOwner, assignableRoles, canManageMembership, RoleRuleError } from "./roles";

/**
 * Memberships of the active organisation (AUTH-03). Reads and writes go
 * through the scoped client. A removed user's session falls back to another
 * organisation on their next request (contextForSession).
 */

export class MembershipError extends Error {
  constructor(readonly code: "not_found" | "same_role") {
    super(`Membership: ${code}`);
    this.name = "MembershipError";
  }
}

export type MemberRow = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: Date;
};

/** One row per membership, sorted by name, then role order. */
export async function listMembers(ctx: AuthContext): Promise<MemberRow[]> {
  const rows = await ctx.db.membership.findMany({
    where: { acceptedAt: { not: null } },
    select: {
      id: true,
      userId: true,
      role: true,
      acceptedAt: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
    },
  });
  return rows
    .map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      joinedAt: m.acceptedAt ?? m.createdAt,
    }))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, "en-ZA") ||
        ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role),
    );
}

async function loadTarget(ctx: AuthContext, membershipId: string) {
  const target = await ctx.db.membership.findFirst({
    where: { id: membershipId, acceptedAt: { not: null } },
    select: { id: true, userId: true, role: true, user: { select: { name: true } } },
  });
  if (!target) throw new MembershipError("not_found");
  if (!canManageMembership(ctx.roles, target.role)) throw new RoleRuleError("owner_only");
  return target;
}

type Db = AuthContext["db"];

async function ownerCount(db: Pick<Db, "membership">): Promise<number> {
  return db.membership.count({ where: { role: "owner", acceptedAt: { not: null } } });
}

/**
 * Runs the last-owner check and its write in one serializable transaction, so
 * two owners demoting or removing each other at once cannot leave the
 * organisation with no owner: Postgres aborts one of them.
 */
function guardedOwnerWrite<T>(
  ctx: AuthContext,
  fn: (tx: Pick<Db, "membership">, owners: number) => Promise<T>,
): Promise<T> {
  return ctx.db.$transaction(async (tx) => fn(tx, await ownerCount(tx)), {
    isolationLevel: "Serializable",
  });
}

export async function changeMemberRole(
  ctx: AuthContext,
  membershipId: string,
  role: Role,
): Promise<{ name: string; from: Role; to: Role }> {
  const target = await loadTarget(ctx, membershipId);
  if (!assignableRoles(ctx.roles).includes(role)) throw new RoleRuleError("not_assignable");
  if (target.role === role) throw new MembershipError("same_role");
  const held = await ctx.db.membership.findFirst({
    where: { userId: target.userId, role },
    select: { id: true },
  });
  if (held) throw new MembershipError("same_role");
  await guardedOwnerWrite(ctx, async (tx, owners) => {
    assertNotLastOwner({ targetRole: target.role, ownerCount: owners, newRole: role });
    await tx.membership.update({ where: { id: target.id }, data: { role } });
  });
  await audit({
    organisationId: ctx.organisationId,
    actorUserId: ctx.user.id,
    action: "membership.role_changed",
    targetType: "Membership",
    targetId: target.id,
    metadata: { from: target.role, to: role, userId: target.userId },
  });
  return { name: target.user.name, from: target.role, to: role };
}

export async function removeMembership(
  ctx: AuthContext,
  membershipId: string,
): Promise<{ name: string; role: Role; userId: string }> {
  const target = await loadTarget(ctx, membershipId);
  await guardedOwnerWrite(ctx, async (tx, owners) => {
    assertNotLastOwner({ targetRole: target.role, ownerCount: owners });
    await tx.membership.delete({ where: { id: target.id } });
  });
  await audit({
    organisationId: ctx.organisationId,
    actorUserId: ctx.user.id,
    action: "membership.removed",
    targetType: "Membership",
    targetId: target.id,
    metadata: { role: target.role, userId: target.userId },
  });
  return { name: target.user.name, role: target.role, userId: target.userId };
}
