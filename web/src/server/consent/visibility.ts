import type { ConsentState } from "@/generated/prisma/enums";
import type { PlayerWhereInput } from "@/generated/prisma/models";
import { GRANTED_STATES, isGranted } from "@/lib/consent-rules";

/**
 * The one place that decides which players a viewer may see (CONS03, NFR08,
 * NFR11; CHUNKS.md "Conventions for every chunk", Consent). Every player query
 * spreads consentVisibleTo(viewer) into its where clause, so the rule is
 * visible in each query (tests/unit/player-queries-consent.test.ts checks it).
 *
 * It filters on Player.consentState, the cache the Consent insert trigger
 * writes in the same statement as the newest row. A withdrawal therefore takes
 * effect on the very next query, with no join on the newest Consent row.
 *
 * Viewer kinds:
 *  - club: club staff on their own squad pages. Every own player, whatever the
 *    consent, so they can see who still needs it.
 *  - club_stats: per-player stats, clips and dashboards for the club (C12 to
 *    C14). Only players with a grant (club_only or scout_visible).
 *  - scout: anything a scout sees outside review (C13, C15). Only
 *    scout_visible, named players.
 * A new viewer (C10/C11 reviewers, for example) adds a kind here, with a test
 * in tests/integration/consent-visibility.test.ts.
 */
export type ConsentViewer = { kind: "club" } | { kind: "club_stats" } | { kind: "scout" };

export function consentVisibleTo(viewer: ConsentViewer): PlayerWhereInput {
  switch (viewer.kind) {
    case "club":
      return {};
    case "club_stats":
      return { consentState: { in: [...GRANTED_STATES] } };
    case "scout":
      return { consentState: "scout_visible", isPlaceholder: false };
  }
}

/**
 * NFR08, data side: whether per-player data (a linked track, an attributed
 * event, a stat) may be derived for a player in this state. Only a grant
 * allows it, for every age: an adult's own consent is recorded by the club
 * (C05 plan, question 2).
 */
export function mayAttribute(state: ConsentState): boolean {
  return isGranted(state);
}

/** A scoped client, or the worker's raw client (C08): anything that can list players. */
type PlayerReader = {
  player: {
    findMany(args: { where: PlayerWhereInput; select: { id: true } }): Promise<{ id: string }[]>;
  };
};

/**
 * The ingest-side gate for C08 (NFR08): of these players, the ones whose
 * tracks may be linked and events attributed. Call it inside the ingest
 * transaction, right before linking, and discard everything else: tracks of
 * other players are never linked, so no per-player data is derived.
 */
export async function attributablePlayerIds(
  db: PlayerReader,
  organisationId: string,
  playerIds: readonly string[],
): Promise<Set<string>> {
  if (playerIds.length === 0) return new Set();
  const rows = await db.player.findMany({
    where: {
      organisationId,
      id: { in: [...playerIds] },
      ...consentVisibleTo({ kind: "club_stats" }),
    },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}
