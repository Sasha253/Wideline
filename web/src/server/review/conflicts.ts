// No "server-only" marker: the worker's review sweep re-checks conflicts.
import type { Prisma } from "@/generated/prisma/client";
import { containsWords, normaliseName } from "@/lib/review-rules";
import { rawDb } from "../db/raw";
import {
  affiliationBlocks,
  declaredAffiliations,
  scoutConflicts,
  type DeclaredAffiliation,
} from "../scouts/conflicts";

/**
 * Conflicts of interest for review claims (REVIEW02, AUTH10; A-8). A scout
 * may not claim a match when any of these holds:
 *  - organisation: the match's organisation is one of scoutConflicts() (a
 *    linked or same-named affiliation, active or removed within 90 days, or a
 *    membership);
 *  - team_name: a declared club name, a represented player's club name, or a
 *    linked organisation's name appears as whole words in either team name.
 *    The opposition is a free-text team in the club's own organisation, so
 *    this is the only way to see a scout who works for the opposition (Q-052);
 *  - player: a declared represented player's name equals the full name of a
 *    named lineup player (not a placeholder), whatever that player's consent
 *    (REVIEW02 names no consent exception; Q-053).
 *
 * The player check reads every named lineup player, so the result can depend
 * on a child the scout may not see by name: a scout who knows a child's name
 * could declare it and watch which queue rows turn conflicted (NFR08, CONS03).
 * REVIEW02 wins over hiding that (Q-053), and the probing is bounded instead:
 * a scout may hold at most 30 player names that still block, removed ones
 * included for their 90-day cooling-off (addOwnAffiliation(), Q-006), every
 * declaration is audited (scout.affiliation_added), every refused claim is
 * audited with its reason codes (review.claim_refused), and scouts are
 * identity-checked and bound by the confidentiality terms (AUTH08, AUTH09).
 * The scout is told only that they are linked to a club or player in the
 * match, never which one or why.
 *
 * The result carries booleans and reason codes only, never a name: the reason
 * is audited and the page says only that the scout is linked to a club or
 * player in the match (tests/unit/review-conflicts.test.ts asserts the keys).
 */

export type ConflictReason = "organisation" | "team_name" | "player";

export type ConflictResult = { conflicted: boolean; reasons: ConflictReason[] };

/** What the checks need about the scout. Server-side only. */
export type ScoutDeclarations = {
  organisationIds: ReadonlySet<string>;
  declared: readonly Pick<
    DeclaredAffiliation,
    "type" | "name" | "clubName" | "linkedOrganisationName" | "removedAt"
  >[];
};

/** What the checks need about the match. Server-side only. */
export type MatchFacts = {
  organisationId: string;
  homeTeamName: string;
  awayTeamName: string;
  /**
   * Named lineup players (not placeholders), whatever their consent. Server
   * only: the names never leave this module.
   */
  lineup: readonly LineupName[];
};

type LineupName = { firstName: string | null; lastName: string | null };

/** The club names a scout's declarations block, for the team-name check. */
function blockedClubNames(declared: ScoutDeclarations["declared"]): string[] {
  const names: string[] = [];
  for (const d of declared) {
    if (d.type === "club") names.push(d.name);
    if (d.type === "player" && d.clubName) names.push(d.clubName);
    if (d.linkedOrganisationName) names.push(d.linkedOrganisationName);
  }
  return names;
}

/**
 * The pure part of reviewConflict, also used by the queue for every row.
 * Declarations past their cooling-off are ignored here too, so a caller that
 * passes stale rows still gets Q-006 right.
 */
export function conflictReasons(
  scout: ScoutDeclarations,
  match: MatchFacts,
  now: Date,
): ConflictResult {
  const declared = scout.declared.filter((d) => affiliationBlocks(d, now));
  const reasons: ConflictReason[] = [];
  if (scout.organisationIds.has(match.organisationId)) reasons.push("organisation");

  const teams = [match.homeTeamName, match.awayTeamName];
  const clubs = blockedClubNames(declared);
  if (clubs.some((club) => teams.some((team) => containsWords(team, club)))) {
    reasons.push("team_name");
  }

  if (representsAny(declared, match.lineup)) reasons.push("player");
  return { conflicted: reasons.length > 0, reasons };
}

/** Whether a represented player's normalised name equals one of these full names. */
function representsAny(
  declared: ScoutDeclarations["declared"],
  lineup: readonly LineupName[],
): boolean {
  const represented = new Set(
    declared
      .filter((d) => d.type === "player")
      .map((d) => normaliseName(d.name))
      .filter((n) => n.length > 0),
  );
  if (represented.size === 0) return false;
  return lineup.some((p) => {
    const full = normaliseName(`${p.firstName ?? ""} ${p.lastName ?? ""}`);
    return full.length > 0 && represented.has(full);
  });
}

/** The raw client or an interactive transaction client. */
type Db = Prisma.TransactionClient;

/** The scout's declarations at `now`, read through `db` (a claim's transaction). */
export async function loadDeclarations(
  scoutUserId: string,
  now: Date,
  db: Db = rawDb,
): Promise<ScoutDeclarations> {
  // One query at a time: db may be an interactive transaction.
  const { organisationIds } = await scoutConflicts(scoutUserId, { now, db });
  const declared = await declaredAffiliations(scoutUserId, { now, db });
  return { organisationIds: new Set(organisationIds), declared };
}

/**
 * The match facts the checks read: both team names and the named lineup
 * players (any consent, REVIEW02), for these matches. The names stay inside
 * this module: callers get reason codes only.
 */
export async function loadMatchFacts(
  matches: readonly { id: string; organisationId: string }[],
  db: Db = rawDb,
): Promise<Map<string, MatchFacts>> {
  const facts = new Map<string, MatchFacts>();
  if (matches.length === 0) return facts;
  const rows = await db.match.findMany({
    where: { OR: matches.map((m) => ({ id: m.id, organisationId: m.organisationId })) },
    select: {
      id: true,
      organisationId: true,
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
      lineups: {
        where: { player: { is: { isPlaceholder: false } } },
        select: { player: { select: { firstName: true, lastName: true } } },
      },
    },
  });
  for (const r of rows) {
    facts.set(r.id, {
      organisationId: r.organisationId,
      homeTeamName: r.homeTeam.name,
      awayTeamName: r.awayTeam.name,
      lineup: r.lineups.map((l) => l.player),
    });
  }
  return facts;
}

/**
 * Whether this scout may not claim this match at `now` (REVIEW02). Pass the
 * claim's transaction as `db`, so a lineup or affiliation written in it (or
 * committed before the match lock) is seen.
 */
export async function reviewConflict(
  db: Db,
  scoutUserId: string,
  match: { id: string; organisationId: string },
  now: Date,
): Promise<ConflictResult> {
  const scout = await loadDeclarations(scoutUserId, now, db);
  const facts = await loadMatchFacts([match], db);
  const f = facts.get(match.id);
  if (!f) return { conflicted: false, reasons: [] };
  return conflictReasons(scout, f, now);
}
