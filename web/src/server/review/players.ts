import "server-only";
import type { EventPlayerSource } from "@/generated/prisma/enums";
import type { ReviewSide } from "@/lib/review-workspace";
import { attributablePlayerIds } from "../consent/visibility";
import { ReviewError } from "./errors";
import { matchTeams, type LiveClaim, type Tx } from "./writes";

/**
 * Naming a player in a review write (C11; REVIEW04 to REVIEW06, NFR08,
 * Q-065). The workspace names players by lineup entry (Lineup.id), never by
 * player id. An entry must be in the claimed match's lineup and on the side's
 * team (not_in_lineup otherwise). Before any per-player data is written, the
 * player's consent is re-read under FOR SHARE, as the CV ingest's
 * recheckLinkedConsent() does: a withdrawal in flight is waited for and seen,
 * and one that starts later waits for this commit, so its purge sees the row.
 */

export type LineupPick = { entryId: string; playerId: string; teamId: string; side: ReviewSide };

/** The lineup entry, on `side` when given. Throws not_in_lineup. */
export async function lineupPick(
  tx: Tx,
  claim: LiveClaim,
  entryId: string,
  side: ReviewSide | null,
): Promise<LineupPick> {
  const entry = await tx.lineup.findFirst({
    where: { id: entryId, organisationId: claim.organisationId, matchId: claim.matchId },
    select: { id: true, playerId: true, teamId: true },
  });
  if (!entry) throw new ReviewError("not_in_lineup");
  const teams = await matchTeams(tx, claim);
  const entrySide: ReviewSide | null =
    entry.teamId === teams.home ? "home" : entry.teamId === teams.away ? "away" : null;
  if (!entrySide || (side && side !== entrySide)) throw new ReviewError("not_in_lineup");
  return { entryId: entry.id, playerId: entry.playerId, teamId: entry.teamId, side: entrySide };
}

/** Whether the player's data may be recorded now, with their row held FOR SHARE until commit. */
export async function mayAttributeNow(
  tx: Tx,
  organisationId: string,
  playerId: string,
): Promise<boolean> {
  await tx.$queryRaw`
    SELECT "id" FROM "Player"
     WHERE "organisationId" = ${organisationId} AND "id" = ${playerId}
       FOR SHARE`;
  const allowed = await attributablePlayerIds(tx, organisationId, [playerId]);
  return allowed.has(playerId);
}

/**
 * Where an event given to this player goes: onto the player's linked track
 * in this match when there is one (so a later relink moves it too), else off
 * any track, named by the reviewer (Event.playerSource reviewer).
 */
export async function eventTargetFor(
  tx: Tx,
  claim: LiveClaim,
  playerId: string,
): Promise<{ trackId: string | null; playerSource: EventPlayerSource }> {
  const track = await tx.track.findFirst({
    where: { organisationId: claim.organisationId, matchId: claim.matchId, playerId },
    orderBy: [{ trackIndex: "asc" }],
    select: { id: true },
  });
  return track
    ? { trackId: track.id, playerSource: "track" }
    : { trackId: null, playerSource: "reviewer" };
}

/**
 * playerId to Lineup.id for this match, so results name entries, not players.
 * Only attributable players are mapped (CONS03, NFR11): a withdrawal takes
 * effect on this read at once, before the consent-withdrawn purge runs, so a
 * withdrawn player's events and track come back team-level (entryId null).
 */
export async function entryIdsByPlayer(tx: Tx, claim: LiveClaim): Promise<Map<string, string>> {
  const rows = await tx.lineup.findMany({
    where: { organisationId: claim.organisationId, matchId: claim.matchId },
    select: { id: true, playerId: true },
  });
  const allowed = await attributablePlayerIds(
    tx,
    claim.organisationId,
    rows.map((r) => r.playerId),
  );
  return new Map(rows.filter((r) => allowed.has(r.playerId)).map((r) => [r.playerId, r.id]));
}
