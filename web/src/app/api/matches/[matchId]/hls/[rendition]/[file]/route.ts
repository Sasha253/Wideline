import { MATCH_ROLES, withRole } from "@/server/auth/session";
import { requireSquadOrg } from "@/server/matches/access";
import { errorResponse } from "@/server/matches/http";
import {
  canPlay,
  matchHlsBase,
  NO_STORE,
  PLAYLIST_TYPE,
  readPlaylist,
  rewriteMediaPlaylist,
  signedSegmentUrl,
} from "@/server/matches/playback";
import { FILE_PATTERN, isRenditionName, MEDIA_PLAYLIST } from "@/server/transcode/ladder";

// GET: one file of one HLS rendition (MATCH06, NFR17). index.m3u8 is the media
// playlist, rewritten so its init and media segments point back here; init.mp4
// and seg_NNNNN.m4s answer 302 to a GET presigned for 60 s. The session and
// role are checked on every request. 404 for an unknown rendition or file,
// another organisation's match, or before the transcode finishes.

type Params = { matchId: string; rendition: string; file: string };

const notFound = () => Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

export const GET = withRole<Params>(
  MATCH_ROLES,
  async (_req, ctx, { matchId, rendition, file }) => {
    try {
      requireSquadOrg(ctx);
      if (!isRenditionName(rendition) || !FILE_PATTERN.test(file)) return notFound();
      const video = await canPlay({ kind: "club", ctx }, matchId);
      if (!video) return notFound();
      const key = `${video.prefix}${rendition}/${file}`;
      if (file === MEDIA_PLAYLIST) {
        const text = await readPlaylist(key);
        return new Response(rewriteMediaPlaylist(text, matchHlsBase(matchId), rendition), {
          headers: { "Content-Type": PLAYLIST_TYPE, ...NO_STORE },
        });
      }
      return new Response(null, {
        status: 302,
        headers: { Location: await signedSegmentUrl(key, file), ...NO_STORE },
      });
    } catch (err) {
      return errorResponse(err, "hls file");
    }
  },
);
