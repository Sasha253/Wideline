// No "server-only" marker: the worker (plain Node, src/worker/review-sweep.ts) runs this.
import { rawDb } from "../db/raw";
import { log } from "../log";
import { alertExpiringReviews } from "./alerts";
import { endClaim, releaseClaimsForScout, releaseConflictedClaims } from "./lifecycle";

/**
 * The review sweep (C10; REVIEW01, REVIEW13, A-5, A-9), every minute:
 *  (a) expires claims past their 48 hours, one transaction per claim, each
 *      with its audit row (every check already treats them as ended; this
 *      tidies up and returns the match to the queue);
 *  (b) releases the claims of scouts who are no longer approved (suspended)
 *      or have no profile (no_profile). Stale terms do not release:
 *      requireReviewer already blocks access, and the claim runs out;
 *  (c) re-checks conflicts for every scout with a live claim (a new
 *      membership from an accepted invitation has no hook of its own);
 *  (d) emails platform admins about unreviewed footage near deletion.
 * Every part is idempotent. One JSON log line with the counts.
 */
export type SweepCounts = {
  expired: number;
  releasedSuspended: number;
  releasedNoProfile: number;
  releasedConflict: number;
  alerted: number;
};

export async function runReviewSweep({
  now = new Date(),
}: { now?: Date } = {}): Promise<SweepCounts> {
  const counts: SweepCounts = {
    expired: 0,
    releasedSuspended: 0,
    releasedNoProfile: 0,
    releasedConflict: 0,
    alerted: 0,
  };

  // (a)
  const stale = await rawDb.reviewClaim.findMany({
    where: { status: "active", expiresAt: { lte: now } },
    select: { id: true, organisationId: true, matchId: true },
  });
  for (const c of stale) {
    const ended = await rawDb.$transaction((tx) =>
      endClaim(tx, c, { status: "expired" }, { actorUserId: null, now }),
    );
    if (ended) counts.expired++;
  }

  // (b) and (c), per scout with a live claim.
  const scouts = await rawDb.reviewClaim.findMany({
    where: { status: "active", expiresAt: { gt: now } },
    select: { scoutUserId: true },
    distinct: ["scoutUserId"],
  });
  const profiles = await rawDb.scoutProfile.findMany({
    where: { userId: { in: scouts.map((s) => s.scoutUserId) } },
    select: { userId: true, status: true },
  });
  const statusOf = new Map(profiles.map((p) => [p.userId, p.status]));
  for (const { scoutUserId } of scouts) {
    const status = statusOf.get(scoutUserId);
    if (status !== "approved") {
      const reason = status === undefined ? "no_profile" : "suspended";
      const n = await rawDb.$transaction((tx) =>
        releaseClaimsForScout(tx, scoutUserId, reason, now),
      );
      if (reason === "no_profile") counts.releasedNoProfile += n;
      else counts.releasedSuspended += n;
      continue;
    }
    counts.releasedConflict += await rawDb.$transaction((tx) =>
      releaseConflictedClaims(tx, scoutUserId, now),
    );
  }

  // (d)
  counts.alerted = await alertExpiringReviews(now);

  log.info({ event: "review_sweep", ...counts }, "review sweep");
  return counts;
}
