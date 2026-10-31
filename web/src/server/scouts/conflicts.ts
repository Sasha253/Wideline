// No "server-only" marker: the worker's review sweep (C10, src/worker/review-sweep.ts)
// re-checks conflicts. Only the raw client and pure helpers are imported.
import type { Prisma } from "@/generated/prisma/client";
import type { OrganisationType, ScoutAffiliationType } from "@/generated/prisma/enums";
import { rawDb } from "../db/raw";

/** Organisation types a scout affiliation can match: the scout's possible conflicts. */
export const LINKABLE_TYPES: OrganisationType[] = ["academy", "club", "agency"];

/**
 * Q-006: a removed affiliation keeps blocking review claims for 90 days. A
 * policy, not a plan limit: it protects clubs and players, so no plan may
 * change it. Memberships count only while they exist (Q-054).
 */
export const CONFLICT_COOLING_OFF_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export type LinkableOrganisation = { id: string; name: string; type: OrganisationType };

/** The raw client or an interactive transaction client (a claim, a hook). */
type Db = Pick<Prisma.TransactionClient, "scoutAffiliation" | "membership" | "organisation">;

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

/** The earliest removal that still blocks at `now` (Q-006). */
export function coolingOffSince(now: Date): Date {
  return new Date(now.getTime() - CONFLICT_COOLING_OFF_DAYS * DAY_MS);
}

/** Until when an affiliation removed at `removedAt` keeps blocking (the /scout copy, C10). */
export function coolingOffUntil(removedAt: Date): Date {
  return new Date(removedAt.getTime() + CONFLICT_COOLING_OFF_DAYS * DAY_MS);
}

/**
 * Whether a declared affiliation blocks at `now`: never removed, or removed
 * less than 90 days ago (Q-006).
 */
export function affiliationBlocks(a: { removedAt: Date | null }, now: Date): boolean {
  return a.removedAt === null || a.removedAt.getTime() > coolingOffSince(now).getTime();
}

/** The where clause for affiliations that block at `now`. */
function blockingWhere(userId: string, now: Date): Prisma.ScoutAffiliationWhereInput {
  return {
    scoutUserId: userId,
    OR: [{ removedAt: null }, { removedAt: { gt: coolingOffSince(now) } }],
  };
}

/**
 * Active academies, clubs and agencies whose name equals one of `names`,
 * case-insensitively, grouped by nameKey. A name can match more than one
 * organisation (an academy and a club with the same name).
 */
export async function organisationsByName(
  names: string[],
  db: Pick<Db, "organisation"> = rawDb,
): Promise<Map<string, LinkableOrganisation[]>> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const byName = new Map<string, LinkableOrganisation[]>();
  if (!unique.length) return byName;
  const organisations = await db.organisation.findMany({
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
 * claim (REVIEW02). Three sources:
 *  - declared affiliations a platform admin linked to an organisation (clubs,
 *    and the clubs of represented players);
 *  - declared affiliations nobody has linked yet whose name (a club's name, a
 *    player's club) equals an active academy, club or agency name,
 *    case-insensitively: every such organisation counts. A declaration blocks
 *    from the moment it is made, not from when an admin gets to it;
 *  - every organisation where the user holds an accepted membership: working
 *    for a club is a conflict even when it is not declared.
 * Declared affiliations count while active and for 90 days after removal
 * (Q-006); memberships only while they exist (Q-054). The scout network and
 * the platform organisation are never conflicts. Pass a transaction client as
 * `db` to see that transaction's own writes (src/server/review/lifecycle.ts).
 */
export async function scoutConflicts(
  userId: string,
  { now = new Date(), db = rawDb }: { now?: Date; db?: Db } = {},
): Promise<{ organisationIds: string[] }> {
  // One query at a time: db may be an interactive transaction.
  const affiliations = await db.scoutAffiliation.findMany({
    where: blockingWhere(userId, now),
    select: { organisationId: true, type: true, name: true, clubName: true },
  });
  const memberships = await db.membership.findMany({
    where: {
      userId,
      acceptedAt: { not: null },
      organisation: { type: { notIn: ["scout_network", "platform"] } },
    },
    select: { organisationId: true },
  });
  const ids = new Set<string>();
  const unlinkedNames: string[] = [];
  for (const a of affiliations) {
    if (a.organisationId) ids.add(a.organisationId);
    else {
      const name = matchName(a);
      if (name) unlinkedNames.push(name);
    }
  }
  for (const matches of (await organisationsByName(unlinkedNames, db)).values()) {
    for (const o of matches) ids.add(o.id);
  }
  for (const m of memberships) ids.add(m.organisationId);
  return { organisationIds: [...ids].sort() };
}

export type DeclaredAffiliation = {
  type: ScoutAffiliationType;
  /** The club's name, or the represented player's name. */
  name: string;
  /** Player rows only: the player's club, as declared. */
  clubName: string | null;
  /** The linked organisation, if a platform admin linked it. */
  organisationId: string | null;
  /** That organisation's current name, for the team-name check (Q-052). */
  linkedOrganisationName: string | null;
  /** Set when the scout removed it (it still blocks for 90 days, Q-006). */
  removedAt: Date | null;
};

/**
 * The scout's declared affiliations that block at `now` (active, or removed
 * within 90 days), for the review checks on team names and lineup players
 * (src/server/review/conflicts.ts). Server-side only: never sent to a page.
 */
export async function declaredAffiliations(
  userId: string,
  { now = new Date(), db = rawDb }: { now?: Date; db?: Db } = {},
): Promise<DeclaredAffiliation[]> {
  const rows = await db.scoutAffiliation.findMany({
    where: blockingWhere(userId, now),
    select: {
      type: true,
      name: true,
      clubName: true,
      organisationId: true,
      organisation: { select: { name: true } },
      removedAt: true,
    },
  });
  return rows.map((r) => ({
    type: r.type,
    name: r.name,
    clubName: r.clubName,
    organisationId: r.organisationId,
    linkedOrganisationName: r.organisation?.name ?? null,
    removedAt: r.removedAt,
  }));
}
