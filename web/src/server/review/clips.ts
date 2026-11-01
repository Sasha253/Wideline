import "server-only";
import { attributablePlayerIds } from "../consent/visibility";
import { rawDb } from "../db/raw";
import type { ClaimScope } from "./scope";

/**
 * The object key of a clip the scout holding the claim may play (C11;
 * REVIEW03, REVIEW11, NFR08, NFR17): a clip of the claimed match (read
 * through the claim's client) whose file still exists, of a team-level event
 * or of a player whose data may be recorded. Null otherwise. The consent check
 * runs on the raw client with the claim's own organisation id: the claim's
 * Player view holds scout_visible players only, and a club_only player's clip
 * is part of the footage the reviewer already streams.
 */
export async function claimClipKey(scope: ClaimScope, clipId: string): Promise<string | null> {
  const clip = await scope.db.clip.findFirst({
    where: { id: clipId, deletedAt: null },
    select: { blobPath: true, eventId: true },
  });
  if (!clip) return null;
  const { claim } = scope;
  if (!clip.blobPath.startsWith(`orgs/${claim.organisationId}/matches/${claim.matchId}/`)) {
    return null;
  }
  const event = await scope.db.event.findFirst({
    where: { id: clip.eventId },
    select: { playerId: true },
  });
  if (!event) return null;
  if (event.playerId !== null) {
    const allowed = await attributablePlayerIds(rawDb, claim.organisationId, [event.playerId]);
    if (!allowed.has(event.playerId)) return null;
  }
  return clip.blobPath;
}
