import { describe, expect, it } from "vitest";
import { canMove, fromStatusesFor } from "@/server/matches/status";

// MATCH07 moves owned so far: C06 (draft and uploading), C07 (processing to
// failed), C08 (processing to awaiting review, once every required job has
// succeeded), C10 (a review claim: awaiting review to in review and back) and
// C11 (marking the match as reviewed: in review to published).
// Nothing moves back to processing.

describe("match status moves", () => {
  it("lets processing move to awaiting review (C08) and to failed (C07)", () => {
    expect(canMove("processing", "awaiting_review")).toBe(true);
    expect(canMove("processing", "failed")).toBe(true);
    expect(fromStatusesFor("failed")).toEqual(["processing"]);
  });

  it("lets a claim move awaiting review to in review, and a release or expiry back (C10)", () => {
    expect(canMove("awaiting_review", "in_review")).toBe(true);
    expect(canMove("in_review", "awaiting_review")).toBe(true);
    expect(fromStatusesFor("in_review")).toEqual(["awaiting_review"]);
    expect(fromStatusesFor("awaiting_review").sort()).toEqual(["in_review", "processing"]);
  });

  it("publishes from in review only (C11)", () => {
    expect(canMove("in_review", "published")).toBe(true);
    expect(fromStatusesFor("published")).toEqual(["in_review"]);
    expect(canMove("awaiting_review", "published")).toBe(false);
    expect(canMove("published", "in_review")).toBe(false);
    expect(canMove("published", "awaiting_review")).toBe(false);
  });

  it("never moves back to processing", () => {
    expect(canMove("awaiting_review", "processing")).toBe(false);
    expect(canMove("in_review", "processing")).toBe(false);
    expect(canMove("failed", "processing")).toBe(false);
    expect(fromStatusesFor("processing")).toEqual(["uploading"]);
  });
});
