// No "server-only" marker: the claim lifecycle (shared with the worker's sweep) imports it.

// Errors for the review module and the copy they carry
// (docs/build/design/C10.md and C11.md, "Error copy").

export type ReviewErrorCode =
  | "not_found"
  | "not_available"
  | "already_claimed"
  | "conflict"
  | "claim_limit"
  | "declaration_required"
  | "claim_ended"
  | "impersonation_refused"
  // C11: the review workspace's writes.
  | "not_attributable"
  | "not_in_lineup"
  | "raw_footage_gone"
  | "out_of_range"
  | "events_pending"
  | "favourite_cap"
  | "sides_confirmed";

export class ReviewError extends Error {
  constructor(
    readonly code: ReviewErrorCode,
    /**
     * The number the copy names: claim_limit, the limit (Infinity when
     * unlimited); events_pending, the events left to check.
     */
    readonly limit?: number,
  ) {
    super(code);
    this.name = "ReviewError";
  }
}

/**
 * Q-064 (docs/build/design/C10.md, '"Log in as" sessions'): a platform admin
 * in a "Log in as" session may view review pages but never claim or release,
 * because the declaration must be the scout's own (AUTH07, NFR20).
 */
export const IMPERSONATION_REFUSED =
  "You are logged in as this scout. Only the scout can claim or release a match, because the declaration must be their own.";

/**
 * Q-064 for the review workspace (docs/build/design/C11.md): the scout's
 * decisions are theirs alone, so a "Log in as" session is read-only.
 */
export const IMPERSONATION_REVIEW_REFUSED =
  "You are logged in as this scout. Only the scout can make review decisions.";

/** Throws impersonation_refused in a "Log in as" session (Q-064). Every review write calls it. */
export function refuseImpersonation(ctx: { impersonator?: unknown }): void {
  if (ctx.impersonator) throw new ReviewError("impersonation_refused");
}

export const DECLARATION_REQUIRED =
  "Confirm that you have no link to either club or to any player in this match.";

/** The C11 refusals with a count: "Check the 3 events left before…". */
export function eventsPendingCopy(n: number): string {
  return n === 1
    ? "Check the 1 event left before you mark the match as reviewed."
    : `Check the ${n} events left before you mark the match as reviewed.`;
}

/**
 * Final copy (docs/build/design/C10.md, C11.md). claim_limit names the limit,
 * events_pending the events left. out_of_range is a field error whose copy
 * names the video's length (outOfRangeCopy).
 */
export const REVIEW_ERROR_COPY = {
  declaration_required: DECLARATION_REQUIRED,
  already_claimed:
    "Another scout claimed this match a moment ago. Choose another match from the queue.",
  conflict:
    "You cannot claim this match because you are linked to a club or player in it. Your list is on your scout profile.",
  claim_limit: (limit: number) =>
    limit === 1
      ? "You already hold 1 claimed match. Finish or release it to claim another."
      : `You already hold ${limit} claimed matches. Finish or release one to claim another.`,
  not_available:
    "This match is no longer waiting for review. It may have been reviewed or deleted.",
  not_found: "We could not find that claim.",
  claim_ended: "This claim has already ended.",
  impersonation_refused: IMPERSONATION_REFUSED,
  not_attributable:
    "This player's events cannot be recorded. Choose another player, or leave the event with the team.",
  not_in_lineup: "That player is not in this match's lineup. Choose a player from the list.",
  raw_footage_gone: "Raw footage for this match has been deleted, so you cannot add missed events.",
  out_of_range: "Enter a time inside the video.",
  events_pending: eventsPendingCopy,
  favourite_cap: "The club that uploaded this match cannot keep any more favourite clips.",
  sides_confirmed: "Home and away are already confirmed for this match, so they cannot be swapped.",
} as const satisfies Record<ReviewErrorCode, string | ((n: number) => string)>;

/** The copy for a refusal. */
export function reviewErrorCopy(err: ReviewError): string {
  const copy = REVIEW_ERROR_COPY[err.code];
  return typeof copy === "function" ? copy(err.limit ?? 1) : copy;
}

export const CLAIM_FAILED = "We could not claim this match. Try again.";
export const RELEASE_FAILED = "We could not release this match. Try again.";

/** C11: any other write error, and the submit's own. */
export const REVIEW_WRITE_FAILED = "We could not save that. Try again.";
export const SUBMIT_FAILED = "We could not mark this match as reviewed. Try again.";
