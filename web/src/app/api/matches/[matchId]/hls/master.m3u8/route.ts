import { MATCH_ROLES, withRole } from "@/server/auth/session";
import { requireSquadOrg } from "@/server/matches/access";
import { errorResponse } from "@/server/matches/http";
import {
  canPlay,
  matchHlsBase,
  NO_STORE,
  PLAYLIST_TYPE,
  readPlaylist,
  rewriteMasterPlaylist,
} from "@/server/matches/playback";
import { MASTER_PLAYLIST } from "@/server/transcode/ladder";

// GET: the match's HLS master playlist (MATCH06, NFR17), read from storage and
// rewritten so every variant points at the session-checked rendition route.
// 404 for another organisation's match or before the transcode finishes.

type Params = { matchId: string };

export const GET = withRole<Params>(MATCH_ROLES, async (_req, ctx, { matchId }) => {
  try {
    requireSquadOrg(ctx);
    const video = await canPlay({ kind: "club", ctx }, matchId);
    if (!video) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    const text = await readPlaylist(`${video.prefix}${MASTER_PLAYLIST}`);
    return new Response(rewriteMasterPlaylist(text, matchHlsBase(matchId)), {
      headers: { "Content-Type": PLAYLIST_TYPE, ...NO_STORE },
    });
  } catch (err) {
    return errorResponse(err, "hls master playlist");
  }
});
