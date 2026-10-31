import { withReviewer } from "@/server/auth/reviewer";
import { errorResponse } from "@/server/matches/http";
import {
  canPlay,
  claimHlsBase,
  NO_STORE,
  PLAYLIST_TYPE,
  readPlaylist,
  rewriteMediaPlaylist,
  signedSegmentUrl,
} from "@/server/matches/playback";
import { claimScope } from "@/server/review/scope";
import { FILE_PATTERN, isRenditionName, MEDIA_PLAYLIST } from "@/server/transcode/ladder";

// GET: one file of one HLS rendition of the claimed match, for the scout
// holding the claim (C10; NFR16, NFR17). index.m3u8 is the media playlist,
// rewritten so its init and media segments point back here; init.mp4 and
// seg_NNNNN.m4s answer 302 to a GET presigned for 60 s. The reviewer guard and
// the claim are checked on every request. 404 for an unknown rendition or
// file, or without a live claim of the caller's.

type Params = { claimId: string; rendition: string; file: string };

const notFound = () => Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

export const GET = withReviewer(async (_req, ctx, { claimId, rendition, file }: Params) => {
  try {
    if (!isRenditionName(rendition) || !FILE_PATTERN.test(file)) return notFound();
    const scope = await claimScope(ctx, claimId);
    if (!scope) return notFound();
    const video = await canPlay({ kind: "claim", scope });
    if (!video) return notFound();
    const key = `${video.prefix}${rendition}/${file}`;
    if (file === MEDIA_PLAYLIST) {
      const text = await readPlaylist(key);
      return new Response(rewriteMediaPlaylist(text, claimHlsBase(claimId), rendition), {
        headers: { "Content-Type": PLAYLIST_TYPE, ...NO_STORE },
      });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: await signedSegmentUrl(key, file), ...NO_STORE },
    });
  } catch (err) {
    return errorResponse(err, "review hls file");
  }
});
