import { describe, expect, it } from "vitest";
import {
  IMPERSONATION_REFUSED,
  REVIEW_ERROR_COPY,
  ReviewError,
  reviewErrorCopy,
  type ReviewErrorCode,
} from "@/server/review/errors";

// C10 (docs/build/design/C10.md, "Error copy"): every refusal has final copy,
// and claim_limit names the limit.

const CODES: ReviewErrorCode[] = [
  "not_found",
  "not_available",
  "already_claimed",
  "conflict",
  "claim_limit",
  "declaration_required",
  "claim_ended",
  "impersonation_refused",
];

describe("review error copy", () => {
  it.each(CODES)("%s has copy", (code) => {
    const copy = reviewErrorCopy(new ReviewError(code, 1));
    expect(copy.length).toBeGreaterThan(10);
    expect(copy).toMatch(/\.$/);
  });

  it("covers exactly the error codes", () => {
    expect(Object.keys(REVIEW_ERROR_COPY).sort()).toEqual([...CODES].sort());
  });

  it("words claim_limit for one and for more than one", () => {
    expect(reviewErrorCopy(new ReviewError("claim_limit", 1))).toBe(
      "You already hold 1 claimed match. Finish or release it to claim another.",
    );
    expect(reviewErrorCopy(new ReviewError("claim_limit", 3))).toBe(
      "You already hold 3 claimed matches. Finish or release one to claim another.",
    );
  });

  it("refuses a 'Log in as' session with the design copy (Q-064)", () => {
    expect(REVIEW_ERROR_COPY.impersonation_refused).toBe(IMPERSONATION_REFUSED);
    expect(IMPERSONATION_REFUSED).toBe(
      "You are logged in as this scout. Only the scout can claim or release a match, because the declaration must be their own.",
    );
  });

  it("never names a club, player or reason code in the conflict copy (A-8)", () => {
    expect(REVIEW_ERROR_COPY.conflict).not.toMatch(/organisation|team_name|player\b.*:/);
    expect(REVIEW_ERROR_COPY.conflict).toBe(
      "You cannot claim this match because you are linked to a club or player in it. Your list is on your scout profile.",
    );
  });
});
