// No "server-only" marker: the claim lifecycle (shared with the worker's sweep) imports it.

// Errors for the review module and the copy they carry
// (docs/build/design/C10.md, "Error copy").

export type ReviewErrorCode =
  | "not_found"
  | "not_available"
  | "already_claimed"
  | "conflict"
  | "claim_limit"
  | "declaration_required"
  | "claim_ended"
  | "impersonation_refused";

export class ReviewError extends Error {
  constructor(
    readonly code: ReviewErrorCode,
    /** claim_limit only: the limit the copy names (Infinity when unlimited). */
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

export const DECLARATION_REQUIRED =
  "Confirm that you have no link to either club or to any player in this match.";

/** Final copy (docs/build/design/C10.md). claim_limit names the limit. */
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
} as const satisfies Record<ReviewErrorCode, string | ((limit: number) => string)>;

/** The copy for a refusal. */
export function reviewErrorCopy(err: ReviewError): string {
  return err.code === "claim_limit"
    ? REVIEW_ERROR_COPY.claim_limit(err.limit ?? 1)
    : REVIEW_ERROR_COPY[err.code];
}

export const CLAIM_FAILED = "We could not claim this match. Try again.";
export const RELEASE_FAILED = "We could not release this match. Try again.";
