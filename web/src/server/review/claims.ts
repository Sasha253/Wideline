import "server-only";
import type { ReviewClaimStatus, ReviewReleaseReason } from "@/generated/prisma/enums";
import {
  CLAIM_DECLARATION_VERSION,
  claimEndsAt,
  isClaimLive,
  queueSection,
} from "@/lib/review-rules";
import type { ReviewerContext } from "../auth/reviewer";
import { audit } from "../audit";
import { rawDb } from "../db/raw";
import { withinLimit } from "../entitlements/resolve";
import { prismaErrorCode } from "../squad/errors";
import { reviewConflict, type ConflictReason } from "./conflicts";
import { refuseImpersonation, ReviewError, type ReviewErrorCode } from "./errors";
import { auditReview, endClaim, expireStaleClaims } from "./lifecycle";
import { claimLimit, QUEUE_MATCH_SELECT, QUEUE_VIDEO_SELECT, toRow, type QueueRow } from "./queue";

/**
 * Claiming and releasing matches (REVIEW01, REVIEW02; AUTH07, NFR20). Every
 * export takes the caller's ReviewerContext (requireReviewer) and touches only
 * that scout's claims. The ending paths shared with the worker's sweep live in
 * ./lifecycle.ts. A "Log in as" session (ctx.impersonator set) can neither
 * claim nor release: the declaration and the audit trail must be the scout's
 * own (Q-064, AUTH07, NFR20).
 */

type Refusal = {
  ok: false;
  code: ReviewErrorCode;
  organisationId?: string;
  reasons?: ConflictReason[];
};
type ClaimOutcome = { ok: true; claimId: string } | Refusal;

type LockedMatch = { organisationId: string; status: string; orgStatus: string; orgType: string };

/**
 * Claims a match for 48 hours. One transaction: an advisory lock per scout
 * (the claim limit), FOR UPDATE on the match, a stale claim on it expired,
 * then the checks (status, accepted video, conflicts, the limit), the claim,
 * the move to In review and the review.claim_started audit row. A refusal for
 * a conflict or the limit is audited too (review.claim_refused, reason codes
 * only), after the rollback, best-effort. A represented player blocks
 * whatever that player's consent (REVIEW02, Q-053). Throws ReviewError.
 */
export async function claimMatch(
  ctx: ReviewerContext,
  matchId: string,
  { declaration, now = new Date() }: { declaration: boolean; now?: Date },
): Promise<{ claimId: string }> {
  refuseImpersonation(ctx);
  if (!declaration) throw new ReviewError("declaration_required");
  // Entitlements use their own reads, so the limit is read first; the count is
  // taken under the advisory lock.
  const limit = await claimLimit();
  const scoutUserId = ctx.user.id;

  let outcome: ClaimOutcome;
  try {
    outcome = await rawDb.$transaction(async (tx): Promise<ClaimOutcome> => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`review-claim:${scoutUserId}`}))::text`;
      const [locked] = await tx.$queryRaw<LockedMatch[]>`
        SELECT m."organisationId", m."status"::text AS "status",
               o."status"::text AS "orgStatus", o."type"::text AS "orgType"
          FROM "Match" m JOIN "Organisation" o ON o."id" = m."organisationId"
         WHERE m."id" = ${matchId}
           FOR UPDATE OF m`;
      if (!locked) return { ok: false, code: "not_available" };
      const { organisationId } = locked;
      if (locked.orgStatus !== "active" || !["academy", "club"].includes(locked.orgType)) {
        return { ok: false, code: "not_available" };
      }

      await expireStaleClaims(tx, { matchId }, now);
      const match = await tx.match.findFirstOrThrow({
        where: { id: matchId, organisationId },
        select: { status: true },
      });
      if (match.status !== "awaiting_review") {
        const live = await tx.reviewClaim.count({
          where: { matchId, status: "active", expiresAt: { gt: now } },
        });
        return { ok: false, code: live > 0 ? "already_claimed" : "not_available" };
      }
      const video = await tx.video.findFirst({
        where: { matchId, organisationId, status: "accepted" },
        select: { id: true, rawExpiresAt: true, deletedAt: true },
      });
      if (!video || queueSection(video, now) === "gone") {
        return { ok: false, code: "not_available" };
      }

      const conflict = await reviewConflict(tx, scoutUserId, { id: matchId, organisationId }, now);
      if (conflict.conflicted) {
        return { ok: false, code: "conflict", organisationId, reasons: conflict.reasons };
      }
      const held = await tx.reviewClaim.count({
        where: { scoutUserId, status: "active", expiresAt: { gt: now } },
      });
      if (!withinLimit(limit, held)) return { ok: false, code: "claim_limit", organisationId };

      const expiresAt = claimEndsAt(now);
      const claim = await tx.reviewClaim.create({
        data: {
          organisationId,
          matchId,
          videoId: video.id,
          scoutUserId,
          status: "active",
          claimedAt: now,
          expiresAt,
        },
        select: { id: true },
      });
      const { count } = await tx.match.updateMany({
        where: { id: matchId, organisationId, status: "awaiting_review" },
        data: { status: "in_review" },
      });
      // Under the row lock this cannot happen; throwing rolls the claim back.
      if (count !== 1) throw new ReviewError("not_available");
      await auditReview(tx, {
        organisationId,
        actorUserId: scoutUserId,
        action: "review.claim_started",
        claimId: claim.id,
        metadata: {
          matchId,
          videoId: video.id,
          expiresAt: expiresAt.toISOString(),
          declaration: CLAIM_DECLARATION_VERSION,
        },
      });
      return { ok: true, claimId: claim.id };
    });
  } catch (err) {
    // The one active claim per match (ReviewClaim_match_active_key).
    if (prismaErrorCode(err) === "P2002") throw new ReviewError("already_claimed");
    throw err;
  }

  if (outcome.ok) return { claimId: outcome.claimId };
  if ((outcome.code === "conflict" || outcome.code === "claim_limit") && outcome.organisationId) {
    await audit({
      organisationId: outcome.organisationId,
      actorUserId: scoutUserId,
      action: "review.claim_refused",
      targetType: "Match",
      targetId: matchId,
      metadata: { matchId, reason: outcome.code, reasons: outcome.reasons ?? [] },
    });
  }
  throw new ReviewError(outcome.code, outcome.code === "claim_limit" ? limit : undefined);
}

/**
 * Releases the caller's own active claim (reason scout). Another scout's
 * claim, or an unknown id, is not_found; an ended claim is claim_ended (a
 * live-looking claim past its end is expired on the way, A-5).
 */
export async function releaseClaim(
  ctx: ReviewerContext,
  claimId: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<void> {
  refuseImpersonation(ctx);
  const result = await rawDb.$transaction(async (tx) => {
    const claim = await tx.reviewClaim.findFirst({
      where: { id: claimId, scoutUserId: ctx.user.id },
      select: { id: true, organisationId: true, matchId: true, status: true, expiresAt: true },
    });
    if (!claim) return "not_found" as const;
    if (claim.status !== "active") return "claim_ended" as const;
    if (!isClaimLive(claim, now)) {
      await endClaim(tx, claim, { status: "expired" }, { actorUserId: null, now });
      return "claim_ended" as const;
    }
    const ended = await endClaim(
      tx,
      claim,
      { status: "released", reason: "scout" },
      { actorUserId: ctx.user.id, now },
    );
    return ended ? ("released" as const) : ("claim_ended" as const);
  });
  if (result !== "released") throw new ReviewError(result);
}

export type OwnClaim = {
  claimId: string;
  /** active only while live: an active claim past its end reads expired (A-5). */
  status: ReviewClaimStatus;
  releaseReason: ReviewReleaseReason | null;
  claimedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  match: QueueRow;
};

/**
 * The caller's claim in any status, with match-level facts only, for the
 * claimed-match page. Null for another scout's claim or an unknown id.
 */
export async function ownClaim(
  ctx: ReviewerContext,
  claimId: string,
  now = new Date(),
): Promise<OwnClaim | null> {
  const c = await rawDb.reviewClaim.findFirst({
    where: { id: claimId, scoutUserId: ctx.user.id },
    select: {
      id: true,
      status: true,
      releaseReason: true,
      claimedAt: true,
      expiresAt: true,
      endedAt: true,
      match: { select: QUEUE_MATCH_SELECT },
      video: { select: QUEUE_VIDEO_SELECT },
    },
  });
  if (!c) return null;
  const toCheck = await rawDb.event.count({
    where: {
      matchId: c.match.id,
      organisationId: c.match.organisationId,
      status: "pending_review",
    },
  });
  const rawExpiresAt = c.video.rawExpiresAt ?? c.expiresAt;
  return {
    claimId: c.id,
    status: c.status === "active" && !isClaimLive(c, now) ? "expired" : c.status,
    releaseReason: c.releaseReason,
    claimedAt: c.claimedAt,
    expiresAt: c.expiresAt,
    endedAt: c.endedAt,
    match: toRow(c.match, { ...c.video, rawExpiresAt }, now, toCheck, false),
  };
}
