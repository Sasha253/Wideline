import type { Prisma } from "@/generated/prisma/client";
import { audit } from "../audit";

/**
 * Clip favourites (C09; CV11), for C11 (reviewers) and C13 (scouts). The
 * caller owns the permission check and the `favourited_clips` cap
 * (hasCapacity) and passes an authorised context. These only insert or
 * delete the row: the database triggers own Clip.expiresAt (any favourite
 * clears it, removing the last restores baseExpiresAt; a deleted clip cannot
 * be favourited). organisationId is the clip's organisation, which for a
 * scout is not their own. Audit rows carry ids only.
 */

export type FavouriteInput = { organisationId: string; clipId: string; userId: string };

/** Favourites the clip. Returns false when the user already had it. */
export async function favouriteClip(
  tx: Prisma.TransactionClient,
  { organisationId, clipId, userId }: FavouriteInput,
): Promise<boolean> {
  const { count } = await tx.clipFavourite.createMany({
    data: [{ organisationId, clipId, userId }],
    skipDuplicates: true,
  });
  if (count === 1) {
    await audit(
      {
        organisationId,
        actorUserId: userId,
        action: "clip.favourited",
        targetType: "Clip",
        targetId: clipId,
      },
      tx,
    );
  }
  return count === 1;
}

/** Removes the favourite. Returns false when there was none. */
export async function unfavouriteClip(
  tx: Prisma.TransactionClient,
  { organisationId, clipId, userId }: FavouriteInput,
): Promise<boolean> {
  const { count } = await tx.clipFavourite.deleteMany({
    where: { organisationId, clipId, userId },
  });
  if (count === 1) {
    await audit(
      {
        organisationId,
        actorUserId: userId,
        action: "clip.unfavourited",
        targetType: "Clip",
        targetId: clipId,
      },
      tx,
    );
  }
  return count === 1;
}
