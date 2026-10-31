import "server-only";
import type { OrganisationType, Role, ScoutStatus } from "@/generated/prisma/enums";
import { ROLE_ORDER, type AuthContext } from "../auth/session";
import { rawDb } from "../db/raw";
import { assertPlatformAdmin } from "./assert";

export type UserMembership = {
  organisationName: string;
  organisationType: OrganisationType;
  roles: Role[];
};

export type UserRow = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  scoutStatus: ScoutStatus | null;
  memberships: UserMembership[];
  /** False for the caller and for platform admins (src/server/auth/impersonation.ts). */
  canImpersonate: boolean;
};

/**
 * Every user, by name, with their accepted memberships in active
 * organisations: the "Log in as" list on /admin/users. Platform admins only.
 */
export async function listUsers(ctx: AuthContext): Promise<UserRow[]> {
  assertPlatformAdmin(ctx);
  const users = await rawDb.user.findMany({
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      scoutProfile: { select: { status: true } },
      memberships: {
        where: { acceptedAt: { not: null }, organisation: { status: "active" } },
        select: {
          role: true,
          organisation: { select: { id: true, name: true, type: true } },
        },
      },
    },
  });

  return users.map((u) => {
    const byOrg = new Map<string, UserMembership>();
    for (const m of u.memberships) {
      const entry = byOrg.get(m.organisation.id) ?? {
        organisationName: m.organisation.name,
        organisationType: m.organisation.type,
        roles: [],
      };
      entry.roles.push(m.role);
      byOrg.set(m.organisation.id, entry);
    }
    for (const m of byOrg.values()) {
      m.roles.sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
    }
    const platformAdmin = u.memberships.some(
      (m) => m.role === "platform_admin" && m.organisation.type === "platform",
    );
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      emailVerified: u.emailVerified,
      scoutStatus: u.scoutProfile?.status ?? null,
      memberships: [...byOrg.values()].sort((a, b) =>
        a.organisationName.localeCompare(b.organisationName, "en-ZA"),
      ),
      canImpersonate: u.id !== ctx.user.id && !platformAdmin,
    };
  });
}
