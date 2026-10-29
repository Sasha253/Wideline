// Object keys for clips (C09; CV11). No "server-only" marker: the clips worker
// (plain Node, src/worker/clips.ts) builds them. Pure.
import { matchPrefix } from "../matches/keys";

/**
 * orgs/{org}/matches/{match}/clips/{eventId}.mp4: under the match prefix, so a
 * match deletion purges it (C06), and one key per event, so a retried cut
 * overwrites the same object (NFR06).
 */
export function clipKey(organisationId: string, matchId: string, eventId: string): string {
  return `${matchPrefix(organisationId, matchId)}clips/${eventId}.mp4`;
}
