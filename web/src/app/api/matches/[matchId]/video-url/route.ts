import { MATCH_ROLES, withRole } from "@/server/auth/session";
import { requireSquadOrg } from "@/server/matches/access";
import { errorResponse } from "@/server/matches/http";
import { signedRawUrl } from "@/server/matches/markers";

// GET: a 15-minute signed URL for the accepted raw footage (MATCH05, NFR17).
// C07: only the marker tool's fallback while the transcode runs; once HLS is
// ready the player uses /api/matches/[matchId]/hls/master.m3u8.

type Params = { matchId: string };

export const GET = withRole<Params>(MATCH_ROLES, async (_req, ctx, { matchId }) => {
  try {
    requireSquadOrg(ctx);
    const signed = await signedRawUrl(ctx, matchId);
    if (!signed) return Response.json({ error: "no_footage" }, { status: 404 });
    return Response.json(signed, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "video url");
  }
});
