import { runReviewSweep, type SweepCounts } from "../server/review/sweep";

/**
 * The review sweep (C10; REVIEW01, REVIEW13, A-5): a scheduled job, every
 * minute, on the transcode worker. Every check already treats a claim past
 * its 48 hours as ended (isClaimLive); this tidies up, returns the match to
 * the queue, releases suspended or conflicted scouts' claims and sends the
 * footage alert (src/server/review/sweep.ts). Idempotent, so a missed or
 * doubled run changes nothing. A throw fails the job; the next minute's run
 * starts over.
 */
export async function handleReviewSweep(now: Date = new Date()): Promise<SweepCounts> {
  return runReviewSweep({ now });
}
