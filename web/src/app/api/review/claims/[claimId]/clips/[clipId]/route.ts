import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { withReviewer } from "@/server/auth/reviewer";
import { errorResponse } from "@/server/matches/http";
import { NO_STORE } from "@/server/matches/playback";
import { claimClipKey } from "@/server/review/clips";
import { claimScope } from "@/server/review/scope";
import { bucket, s3Public } from "@/server/storage";

// GET: one event clip of the claimed match, for the scout holding the claim
// (C11; REVIEW03, REVIEW11, NFR16, NFR17). The workspace plays it when the
// raw footage is gone (clips only). The reviewer guard and the claim are
// checked on every request, then a 302 to a GET presigned for 60 s, served
// inline as MP4, never cached. 404 without a live claim of the caller's (so
// after a submit, a release or an expiry), and for a clip of another match,
// a deleted clip, or a clip of a player whose data may not be recorded.

type Params = { claimId: string; clipId: string };

const CLIP_URL_TTL_SEC = 60;

const notFound = () => Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

export const GET = withReviewer(async (_req, ctx, { claimId, clipId }: Params) => {
  try {
    const scope = await claimScope(ctx, claimId);
    if (!scope) return notFound();
    const key = await claimClipKey(scope, clipId);
    if (!key) return notFound();
    const url = await getSignedUrl(
      s3Public(),
      new GetObjectCommand({
        Bucket: bucket(),
        Key: key,
        ResponseContentType: "video/mp4",
        ResponseContentDisposition: "inline",
      }),
      { expiresIn: CLIP_URL_TTL_SEC },
    );
    return new Response(null, { status: 302, headers: { Location: url, ...NO_STORE } });
  } catch (err) {
    return errorResponse(err, "review clip");
  }
});
