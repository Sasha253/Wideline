import { withReviewer } from "@/server/auth/reviewer";
import { errorResponse } from "@/server/matches/http";
import {
  canPlay,
  claimHlsBase,
  NO_STORE,
  PLAYLIST_TYPE,
  readPlaylist,
  rewriteMasterPlaylist,
} from "@/server/matches/playback";
import { claimScope } from "@/server/review/scope";
import { MASTER_PLAYLIST } from "@/server/transcode/ladder";

// GET: the claimed match's HLS master playlist for the scout holding the claim
// (C10; REVIEW01, NFR16, NFR17), rewritten so every variant points at the
// claim's rendition route. The reviewer guard and the claim are checked on
// every request, so access ends at the next request after an expiry, a
// release or a suspension. 404 without a live claim of the caller's.

type Params = { claimId: string };

const notFound = () => Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

export const GET = withReviewer(async (_req, ctx, { claimId }: Params) => {
  try {
    const scope = await claimScope(ctx, claimId);
    if (!scope) return notFound();
    const video = await canPlay({ kind: "claim", scope });
    if (!video) return notFound();
    const text = await readPlaylist(`${video.prefix}${MASTER_PLAYLIST}`);
    return new Response(rewriteMasterPlaylist(text, claimHlsBase(claimId)), {
      headers: { "Content-Type": PLAYLIST_TYPE, ...NO_STORE },
    });
  } catch (err) {
    return errorResponse(err, "review hls master playlist");
  }
});
