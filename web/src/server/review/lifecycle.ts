// No "server-only" marker: the worker's review sweep (plain Node) runs this.
import type { Prisma } from "@/generated/prisma/client";
import type { ReviewReleaseReason } from "@/generated/prisma/enums";
import { lockMatchForUpdate } from "../db/locks";
import { reviewConflict } from "./conflicts";

/**
 * How review claims end (C10; REVIEW01, ADMIN06, NFR20): released (by the
 * scout, a suspension, a new conflict, a missing profile, or a platform admin
 * from C18) or expired after 48 hours. Each one moves the match back to
 * Awaiting review and writes its audit row in the same transaction. Shared by
 * the claim pages (src/server/review/claims.ts), the C02 hooks (suspension,
 * new affiliations) and the worker's sweep, so it imports nothing that needs
 * the Next.js server (audit rows are written on the transaction directly).
 * C11 adds the submit path.
 */

type Tx = Prisma.TransactionClient;

export type ClaimRef = { id: string; organisationId: string; matchId: string };

export type EndOutcome =
  { status: "released"; reason: ReviewReleaseReason } | { status: "expired" };

/** An audit row in the caller's transaction (AUTH07, NFR20). Ids and reason codes only. */
export async function auditReview(
  tx: Tx,
  entry: {
    organisationId: string;
    actorUserId: string | null;
    action: string;
    claimId: string;
    metadata: Prisma.InputJsonValue;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      organisationId: entry.organisationId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: "ReviewClaim",
      targetId: entry.claimId,
      metadata: entry.metadata,
    },
  });
}

/**
 * Ends one active claim inside the caller's transaction: locks the match,
 * ends the claim with a guarded update, moves the match In review to Awaiting
 * review, and audits review.claim_released or review.claim_expired. Returns
 * false, changing nothing, when the claim had already ended (someone else got
 * there first). actorUserId is the scout or admin, or null for the sweep.
 */
export async function endClaim(
  tx: Tx,
  claim: ClaimRef,
  outcome: EndOutcome,
  { actorUserId, now }: { actorUserId: string | null; now: Date },
): Promise<boolean> {
  await lockMatchForUpdate(tx, claim.organisationId, claim.matchId);
  const { count } = await tx.reviewClaim.updateMany({
    where: { id: claim.id, organisationId: claim.organisationId, status: "active" },
    data: {
      status: outcome.status,
      endedAt: now,
      releaseReason: outcome.status === "released" ? outcome.reason : null,
    },
  });
  if (count !== 1) return false;
  await tx.match.updateMany({
    where: { id: claim.matchId, organisationId: claim.organisationId, status: "in_review" },
    data: { status: "awaiting_review" },
  });
  await auditReview(tx, {
    organisationId: claim.organisationId,
    actorUserId,
    action: outcome.status === "released" ? "review.claim_released" : "review.claim_expired",
    claimId: claim.id,
    metadata: {
      matchId: claim.matchId,
      reason: outcome.status === "released" ? outcome.reason : "expired",
    },
  });
  return true;
}

const CLAIM_REF = { id: true, organisationId: true, matchId: true } as const;

/**
 * Expires the active claims past their end (expiresAt <= now), optionally for
 * one match. The claim transaction calls it for its match, so a claim made
 * the moment another expires succeeds even before the sweep runs (A-5).
 * Returns how many it expired.
 */
export async function expireStaleClaims(
  tx: Tx,
  filter: { matchId?: string },
  now: Date,
): Promise<number> {
  const stale = await tx.reviewClaim.findMany({
    where: { status: "active", expiresAt: { lte: now }, ...filter },
    select: CLAIM_REF,
  });
  let n = 0;
  for (const c of stale) {
    if (await endClaim(tx, c, { status: "expired" }, { actorUserId: null, now })) n++;
  }
  return n;
}

/**
 * Releases every active claim of a scout, for a suspension (ADMIN06, in
 * suspendScout's transaction) or a scout with no profile (the sweep).
 */
export async function releaseClaimsForScout(
  tx: Tx,
  scoutUserId: string,
  reason: ReviewReleaseReason,
  now: Date,
  actorUserId: string | null = null,
): Promise<number> {
  const claims = await tx.reviewClaim.findMany({
    where: { scoutUserId, status: "active" },
    select: CLAIM_REF,
  });
  let n = 0;
  for (const c of claims) {
    if (await endClaim(tx, c, { status: "released", reason }, { actorUserId, now })) n++;
  }
  return n;
}

/**
 * Re-checks each of the scout's live claims against their conflicts and
 * releases the conflicted ones (reason conflict, A-9). Called in the
 * transaction that adds or links an affiliation, so it sees the new row, and
 * by the sweep for new memberships.
 */
export async function releaseConflictedClaims(
  tx: Tx,
  scoutUserId: string,
  now: Date,
  actorUserId: string | null = null,
): Promise<number> {
  const claims = await tx.reviewClaim.findMany({
    where: { scoutUserId, status: "active", expiresAt: { gt: now } },
    select: CLAIM_REF,
  });
  let n = 0;
  for (const c of claims) {
    const { conflicted } = await reviewConflict(
      tx,
      scoutUserId,
      { id: c.matchId, organisationId: c.organisationId },
      now,
    );
    if (!conflicted) continue;
    const ended = await endClaim(
      tx,
      c,
      { status: "released", reason: "conflict" },
      { actorUserId, now },
    );
    if (ended) n++;
  }
  return n;
}
