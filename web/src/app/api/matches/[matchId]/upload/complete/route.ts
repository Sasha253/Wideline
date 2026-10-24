import { MATCH_ROLES, withRole } from "@/server/auth/session";
import { requireSquadOrg } from "@/server/matches/access";
import { videoIdSchema } from "@/server/matches/fields";
import { errorResponse, jsonBody } from "@/server/matches/http";
import { completeUpload } from "@/server/matches/upload";

// POST { videoId }: completes the upload once every part arrived. Idempotent.
// 409 { error: "missing_parts", missing: [...] } lists the parts to send again.

type Params = { matchId: string };

export const POST = withRole<Params>(MATCH_ROLES, async (req, ctx, { matchId }) => {
  try {
    requireSquadOrg(ctx);
    const { videoId } = videoIdSchema.parse(await jsonBody(req));
    return Response.json(await completeUpload(ctx, matchId, videoId));
  } catch (err) {
    return errorResponse(err, "upload complete");
  }
});
