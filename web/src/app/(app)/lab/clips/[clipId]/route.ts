import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { LAB_ROLES, withRole } from "@/server/auth/session";
import { attributablePlayerIds } from "@/server/consent/visibility";
import { bucket, s3Public } from "@/server/storage";

// GET /lab/clips/[clipId] (docs/build/design/C09.md, Surface 3): a platform
// admin opens an event clip from the match benchmark view. Session-checked,
// then a 302 to a 60-second presigned GET of the MP4 (NFR17); the browser's
// own player shows it. An unknown, other-organisation or deleted clip is 404,
// and so is a clip of a player who may not be attributed (NFR08): only
// team-level clips and attributable players' clips are served.
// Club and scout playback routes are C11 and C13.

type Params = { clipId: string };

const CLIP_URL_TTL_SEC = 60;

const notFound = () => new Response("Not found", { status: 404 });

export const GET = withRole<Params>(LAB_ROLES, async (_req, ctx, { clipId }) => {
  const clip = await ctx.db.clip.findFirst({
    where: { id: clipId, deletedAt: null },
    select: { blobPath: true, event: { select: { playerId: true } } },
  });
  if (!clip) return notFound();
  const playerId = clip.event.playerId;
  if (playerId !== null) {
    const allowed = await attributablePlayerIds(ctx.db, ctx.organisationId, [playerId]);
    if (!allowed.has(playerId)) return notFound();
  }
  const url = await getSignedUrl(
    s3Public(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: clip.blobPath,
      ResponseContentType: "video/mp4",
    }),
    { expiresIn: CLIP_URL_TTL_SEC },
  );
  return new Response(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "no-store" },
  });
});
