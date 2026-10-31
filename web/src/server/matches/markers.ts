import "server-only";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { MARKER_KEYS, markerPastEnd, validateMarkers, type MarkerKey } from "@/lib/match-clock";
import type { AuthContext } from "../auth/session";
import { audit } from "../audit";
import { lockMatchShared } from "../db/locks";
import { asTransactionClient } from "../squad/tx";
import { bucket, s3Public } from "../storage";
import { isLocked, requireSquadOrg } from "./access";
import { lockedMessage, MatchError } from "./errors";
import { markersSchema, type MarkersInput } from "./fields";

/**
 * Kickoff and half-time markers (MATCH05; docs/build/design/C06.md, Surface 5):
 * four video offsets on the accepted video, so video time maps to match
 * minutes. Blank markers may be saved; the order is checked among those set,
 * here and in the database (CHECK "Video_markers_ordered").
 */

/** Signed raw-video URLs last 15 minutes (NFR17). C07 replaces them with HLS. */
export const RAW_URL_TTL_SEC = 15 * 60;

/** Saves the four markers on the match's accepted video. Audits which were set. */
export async function saveMarkers(
  ctx: AuthContext,
  matchId: string,
  input: MarkersInput,
): Promise<void> {
  requireSquadOrg(ctx);
  const data = markersSchema.parse(input);
  await ctx.db.$transaction(async (tx) => {
    // C10 (A-6): as lineup saves, FOR SHARE so a review claim never races this.
    await lockMatchShared(tx, ctx.organisationId, matchId);
    const match = await tx.match.findFirst({
      where: { id: matchId },
      select: {
        status: true,
        videos: {
          where: { status: "accepted", deletedAt: null },
          select: { id: true, durationSec: true },
        },
      },
    });
    if (!match) throw new MatchError("not_found");
    if (isLocked(match.status)) {
      throw new MatchError("locked", lockedMessage("Markers", match.status));
    }
    const video = match.videos[0];
    if (!video) throw new MatchError("no_footage");

    const fieldErrors: Partial<Record<MarkerKey, string>> = {};
    const endMs = video.durationSec !== null ? Math.floor(video.durationSec * 1000) : null;
    for (const key of MARKER_KEYS) {
      const v = data[key];
      if (v !== null && endMs !== null && v > endMs) fieldErrors[key] = markerPastEnd(endMs);
    }
    const order = validateMarkers(data);
    for (const key of MARKER_KEYS) fieldErrors[key] ??= order[key];
    const errors = Object.fromEntries(Object.entries(fieldErrors).filter(([, v]) => v)) as Record<
      string,
      string
    >;
    if (Object.keys(errors).length) {
      throw new MatchError("invalid", undefined, undefined, errors);
    }

    await tx.video.update({ where: { id: video.id }, data });
    await audit(
      {
        organisationId: ctx.organisationId,
        actorUserId: ctx.user.id,
        action: "video.markers_saved",
        targetType: "Video",
        targetId: video.id,
        metadata: { matchId, set: MARKER_KEYS.filter((k) => data[k] !== null) },
      },
      asTransactionClient(tx),
    );
  });
}

/**
 * A 15-minute GET URL for the raw file of the match's accepted video, for the
 * marker tool's native player. Signed for the public S3 host. Null when there
 * is no accepted footage or its file was deleted.
 */
export async function signedRawUrl(
  ctx: AuthContext,
  matchId: string,
): Promise<{ url: string; expiresAt: Date } | null> {
  requireSquadOrg(ctx);
  const video = await ctx.db.video.findFirst({
    where: { matchId, status: "accepted", deletedAt: null },
    select: { blobPath: true, contentType: true },
  });
  if (!video) return null;
  const url = await getSignedUrl(
    s3Public(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: video.blobPath,
      ResponseContentType: video.contentType,
    }),
    { expiresIn: RAW_URL_TTL_SEC },
  );
  return { url, expiresAt: new Date(Date.now() + RAW_URL_TTL_SEC * 1000) };
}
