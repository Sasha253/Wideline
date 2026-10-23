import "server-only";
import type { OrganisationType, ScoutAffiliationType } from "@/generated/prisma/enums";
import { rawDb } from "../db/raw";

/** Organisation types a scout affiliation can match: the scout's possible conflicts. */
export const LINKABLE_TYPES: OrganisationType[] = ["academy", "club", "agency"];

export type LinkableOrganisation = { id: string; name: string; type: OrganisationType };

/** The comparison key for names: trimmed, case-insensitive. */
export const nameKey = (name: string) => name.trim().toLowerCase();

/** The name an affiliation matches on: a club's own name, or a represented player's club. */
export function matchName(a: {
  type: ScoutAffiliationType;
  name: string;
  clubName: string | null;
}): string | null {
  const name = a.type === "club" ? a.name : a.clubName;
  return name?.trim() ? name.trim() : null;
}

/**
 * Active academies, clubs and agencies whose name equals one of `names`,
 * case-insensitively, grouped by nameKey. A name can match more than one
 * organisation (an academy and a club with the same name).
 */
export async function organisationsByName(
  names: string[],
): Promise<Map<string, LinkableOrganisation[]>> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const byName = new Map<string, LinkableOrganisation[]>();
  if (!unique.length) return byName;
  const organisations = await rawDb.organisation.findMany({
    where: {
      status: "active",
      type: { in: LINKABLE_TYPES },
      OR: unique.map((name) => ({ name: { equals: name, mode: "insensitive" as const } })),
    },
    select: { id: true, name: true, type: true },
    orderBy: { name: "asc" },
  });
  for (const o of organisations) {
    const key = nameKey(o.name);
    byName.set(key, [...(byName.get(key) ?? []), o]);
  }
  return byName;
}

/**
 * The organisations a scout may not review (AUTH10). C10 calls this before a
 * claim (REVIEW02). Active affiliations only. Three sources:
 *  - declared affiliations a platform admin linked to an organisation (clubs,
 *    and the clubs of represented players);
 *  - declared affiliations nobody has linked yet whose name (a club's name, a
 *    player's club) equals an active academy, club or agency name,
 *    case-insensitively: every such organisation counts. A declaration blocks
 *    from the moment it is made, not from when an admin gets to it;
 *  - every organisation where the user holds an accepted membership: working
 *    for a club is a conflict even when it is not declared.
 * The scout network and the platform organisation are never conflicts.
 */
export async function scoutConflicts(userId: string): Promise<{ organisationIds: string[] }> {
  const [affiliations, memberships] = await Promise.all([
    rawDb.scoutAffiliation.findMany({
      where: { scoutUserId: userId, removedAt: null },
      select: { organisationId: true, type: true, name: true, clubName: true },
    }),
    rawDb.membership.findMany({
      where: {
        userId,
        acceptedAt: { not: null },
        organisation: { type: { notIn: ["scout_network", "platform"] } },
      },
      select: { organisationId: true },
    }),
  ]);
  const ids = new Set<string>();
  const unlinkedNames: string[] = [];
  for (const a of affiliations) {
    if (a.organisationId) ids.add(a.organisationId);
    else {
      const name = matchName(a);
      if (name) unlinkedNames.push(name);
    }
  }
  for (const matches of (await organisationsByName(unlinkedNames)).values()) {
    for (const o of matches) ids.add(o.id);
  }
  for (const m of memberships) ids.add(m.organisationId);
  return { organisationIds: [...ids].sort() };
}
