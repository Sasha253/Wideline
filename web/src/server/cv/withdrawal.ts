import { attributablePlayerIds } from "../consent/visibility";
import { rawDb } from "../db/raw";
import { log } from "../log";

/**
 * NFR08 and NFR11 for C08's own artefacts: when a consent change takes away
 * the grant (the consent-withdrawn job), the player's CV data goes within 24
 * hours. If attributablePlayerIds() no longer passes the player, their events
 * lose the track, the player and the position, and their tracks are deleted
 * (the points cascade), in one transaction. A change to club only still
 * passes, so nothing is purged for it. The events' clips (C09) are kept: with
 * the player unlinked they are team-level footage (QUESTIONS.md Q-047). C11:
 * events a reviewer gave to the player on their own (playerSource reviewer,
 * no track) lose the player too, and the player's id goes from the review
 * training rows (EventCorrection.previousPlayerId and newPlayerId), so no
 * per-player record is kept. Derived stats and shortlists are purged by C12
 * and C15 in the same job. Logs carry ids and counts.
 */
export async function purgeUnattributablePlayerTracks(
  organisationId: string,
  playerId: string,
): Promise<{ tracks: number; events: number }> {
  return rawDb.$transaction(async (tx) => {
    const allowed = await attributablePlayerIds(tx, organisationId, [playerId]);
    if (allowed.has(playerId)) return { tracks: 0, events: 0 };
    const { count: events } = await tx.event.updateMany({
      where: { organisationId, playerId },
      data: { playerId: null, playerSource: null, trackId: null, pitchX: null, pitchY: null },
    });
    // Events on the player's tracks that were never attributed (none today:
    // ingest sets playerId from the track) are unlinked too before the delete.
    await tx.event.updateMany({
      where: { organisationId, track: { playerId } },
      data: { trackId: null, pitchX: null, pitchY: null },
    });
    const { count: tracks } = await tx.track.deleteMany({ where: { organisationId, playerId } });
    await tx.eventCorrection.updateMany({
      where: { organisationId, previousPlayerId: playerId },
      data: { previousPlayerId: null },
    });
    await tx.eventCorrection.updateMany({
      where: { organisationId, newPlayerId: playerId },
      data: { newPlayerId: null },
    });
    log.info({ organisationId, playerId, tracks, events }, "consent withdrawn: cv data purged");
    return { tracks, events };
  });
}
