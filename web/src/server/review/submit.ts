import "server-only";
import type { ReviewerContext } from "../auth/reviewer";
import { log } from "../log";
import { fromStatusesFor } from "../matches/status";
import { getBoss, QUEUES, type MatchPublishedJob } from "../queue";
import { claimCounts, type ClaimCounts } from "./corrections";
import { ReviewError } from "./errors";
import { auditReview } from "./lifecycle";
import type { ClaimScope } from "./scope";
import { withLiveClaim } from "./writes";

/**
 * Mark as reviewed (C11; REVIEW08, REVIEW11, AUTH07, Q-066). One transaction,
 * under the match lock and then the claim lock (the order endClaim uses):
 * refused while any pending_review event is left (events_pending, with the
 * count); otherwise the claim is submitted with its counts (claimCounts,
 * Q-067), the match moves In review to Published with publishedAt, and the
 * review.claim_submitted audit row is written (ids and counts only). Access
 * to the footage ends with it: claimScope() refuses a submitted claim on the
 * next request. After commit, the match-published job goes to C12, which
 * builds the stats. A lost send is logged; C12's backfill picks the match up
 * from Match.publishedAt.
 */

export async function submitReview(
  ctx: ReviewerContext,
  scope: ClaimScope,
  { now = new Date() }: { now?: Date } = {},
): Promise<ClaimCounts> {
  const counts = await withLiveClaim(
    ctx,
    scope,
    async (tx, claim) => {
      const where = { organisationId: claim.organisationId, matchId: claim.matchId };
      const remaining = await tx.event.count({ where: { ...where, status: "pending_review" } });
      if (remaining > 0) throw new ReviewError("events_pending", remaining);
      const counts = await claimCounts(tx, claim);
      const ended = await tx.reviewClaim.updateMany({
        where: { id: claim.id, organisationId: claim.organisationId, status: "active" },
        data: {
          status: "submitted",
          submittedAt: now,
          endedAt: now,
          eventsReviewed: counts.eventsReviewed,
          corrections: counts.corrections,
        },
      });
      if (ended.count !== 1) throw new ReviewError("claim_ended");
      const published = await tx.match.updateMany({
        where: {
          id: claim.matchId,
          organisationId: claim.organisationId,
          status: { in: fromStatusesFor("published") },
        },
        data: { status: "published", publishedAt: now },
      });
      // A live claim keeps its match In review; anything else rolls back.
      if (published.count !== 1) throw new ReviewError("not_available");
      await auditReview(tx, {
        organisationId: claim.organisationId,
        actorUserId: ctx.user.id,
        action: "review.claim_submitted",
        claimId: claim.id,
        metadata: {
          matchId: claim.matchId,
          eventsReviewed: counts.eventsReviewed,
          corrections: counts.corrections,
          added: counts.added,
        },
      });
      return counts;
    },
    { now, lockMatch: true },
  );

  const job: MatchPublishedJob = {
    organisationId: scope.claim.organisationId,
    matchId: scope.claim.matchId,
    claimId: scope.claim.id,
  };
  try {
    const boss = await getBoss();
    await boss.send(QUEUES.matchPublished, job, { singletonKey: scope.claim.id });
  } catch (err) {
    log.error({ err, ...job }, "match-published enqueue failed");
  }
  return counts;
}
