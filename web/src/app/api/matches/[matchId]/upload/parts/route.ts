import { MATCH_ROLES, withRole } from "@/server/auth/session";
import { requireSquadOrg } from "@/server/matches/access";
import { errorResponse, jsonBody } from "@/server/matches/http";
import { presignParts } from "@/server/matches/upload";

// POST { videoId, partNumbers }: presigned UploadPart URLs, valid for 1 hour,
// for up to 50 parts of the open upload (MATCH02).

type Params = { matchId: string };

export const POST = withRole<Params>(MATCH_ROLES, async (req, ctx, { matchId }) => {
  try {
    requireSquadOrg(ctx);
    const urls = await presignParts(ctx, matchId, (await jsonBody(req)) as never);
    return Response.json({ urls });
  } catch (err) {
    return errorResponse(err, "part presign");
  }
});
