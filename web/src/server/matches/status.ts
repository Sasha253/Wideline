import type { MatchStatus } from "@/generated/prisma/enums";

/**
 * Match status moves (MATCH07). C06: Draft and Uploading go back and forth (an
 * upload starts, is cancelled or rejected); accepted footage moves Uploading
 * to Processing. C07: a transcode that fails its last attempt moves
 * Processing to Failed (NFR30). C08: once every required processing job of
 * the accepted video has succeeded (src/server/processing/readiness.ts),
 * Processing moves to Awaiting review; a CV job that fails its last attempt
 * moves it to Failed. C10 owns the review claim moves: a claim moves Awaiting
 * review to In review, and a release or expiry moves it back
 * (src/server/review/). C11: marking the match as reviewed moves In review to
 * Published (submitReview in src/server/review/submit.ts); C12 builds the
 * stats from it.
 */
export const MATCH_TRANSITIONS: Partial<Record<MatchStatus, readonly MatchStatus[]>> = {
  draft: ["uploading"],
  uploading: ["draft", "processing"],
  processing: ["awaiting_review", "failed"],
  awaiting_review: ["in_review"],
  in_review: ["awaiting_review", "published"],
};

export function canMove(from: MatchStatus, to: MatchStatus): boolean {
  return MATCH_TRANSITIONS[from]?.includes(to) ?? false;
}

/** The statuses a move to `to` may start from, for a guarded updateMany. */
export function fromStatusesFor(to: MatchStatus): MatchStatus[] {
  return (Object.keys(MATCH_TRANSITIONS) as MatchStatus[]).filter((from) => canMove(from, to));
}
