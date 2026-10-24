import { MATCH_ROLES, withRole } from "@/server/auth/session";
import { requireSquadOrg } from "@/server/matches/access";
import { videoIdSchema } from "@/server/matches/fields";
import { errorResponse, jsonBody } from "@/server/matches/http";
import { cancelUpload, startUpload, uploadStatus } from "@/server/matches/upload";

// The match's upload (MATCH02, NFR26; docs/build/design/C06.md, Surface 3).
// GET: the live video and the parts that arrived (ListParts). POST: start, or
// resume the same file. DELETE: cancel the open upload.

type Params = { matchId: string };

export const GET = withRole<Params>(MATCH_ROLES, async (_req, ctx, { matchId }) => {
  try {
    requireSquadOrg(ctx);
    return Response.json({ video: await uploadStatus(ctx, matchId) });
  } catch (err) {
    return errorResponse(err, "upload status");
  }
});

export const POST = withRole<Params>(MATCH_ROLES, async (req, ctx, { matchId }) => {
  try {
    requireSquadOrg(ctx);
    const body = (await jsonBody(req)) as Record<string, unknown>;
    return Response.json({ video: await startUpload(ctx, matchId, body as never) });
  } catch (err) {
    return errorResponse(err, "upload start");
  }
});

export const DELETE = withRole<Params>(MATCH_ROLES, async (req, ctx, { matchId }) => {
  try {
    requireSquadOrg(ctx);
    const { videoId } = videoIdSchema.parse(await jsonBody(req));
    await cancelUpload(ctx, matchId, videoId);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err, "upload cancel");
  }
});
