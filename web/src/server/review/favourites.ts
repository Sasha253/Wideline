import "server-only";
import type { ReviewerContext } from "../auth/reviewer";
import { favouriteClip, unfavouriteClip } from "../clips/favourites";
import { scopedDb } from "../db/scoped";
import { hasCapacity } from "../entitlements";
import { refuseImpersonation, ReviewError } from "./errors";
import type { ClaimScope } from "./scope";
import { withLiveClaim } from "./writes";

/**
 * Favourite a clip from the review workspace (C11; PROF08, CV11). The clip
 * must belong to the claimed match and still have its file (read through the
 * claim's client). A favourite counts against the clip organisation's
 * favourited_clips limit (BILL01), since it keeps that organisation's clip
 * past its expiry, and it outlives the claim. The row itself is written by
 * favouriteClip()/unfavouriteClip() inside a claim-checked transaction; the
 * database triggers keep Clip.expiresAt.
 */

async function claimClip(scope: ClaimScope, clipId: string) {
  const clip = await scope.db.clip.findFirst({
    where: { id: clipId, deletedAt: null },
    select: { id: true },
  });
  if (!clip) throw new ReviewError("not_found");
  return clip;
}

export async function favouriteReviewClip(
  ctx: ReviewerContext,
  scope: ClaimScope,
  clipId: string,
  { now }: { now?: Date } = {},
): Promise<{ favourited: true }> {
  refuseImpersonation(ctx);
  await claimClip(scope, clipId);
  const organisationId = scope.claim.organisationId;
  const used = await scopedDb(organisationId).clipFavourite.count();
  if (!(await hasCapacity(organisationId, "favourited_clips", used))) {
    throw new ReviewError("favourite_cap");
  }
  await withLiveClaim(
    ctx,
    scope,
    (tx) => favouriteClip(tx, { organisationId, clipId, userId: ctx.user.id }),
    { now },
  );
  return { favourited: true };
}

export async function unfavouriteReviewClip(
  ctx: ReviewerContext,
  scope: ClaimScope,
  clipId: string,
  { now }: { now?: Date } = {},
): Promise<{ favourited: false }> {
  refuseImpersonation(ctx);
  await claimClip(scope, clipId);
  const organisationId = scope.claim.organisationId;
  await withLiveClaim(
    ctx,
    scope,
    (tx) => unfavouriteClip(tx, { organisationId, clipId, userId: ctx.user.id }),
    { now },
  );
  return { favourited: false };
}
