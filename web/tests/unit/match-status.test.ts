import { describe, expect, it } from "vitest";
import { canMove, fromStatusesFor } from "@/server/matches/status";

// MATCH07 moves owned so far: C06 (draft and uploading), C07 (processing to
// failed) and C08 (processing to awaiting review, once every required job has
// succeeded). Nothing moves back to processing.

describe("match status moves", () => {
  it("lets processing move to awaiting review (C08) and to failed (C07)", () => {
    expect(canMove("processing", "awaiting_review")).toBe(true);
    expect(canMove("processing", "failed")).toBe(true);
    expect(fromStatusesFor("awaiting_review")).toEqual(["processing"]);
  });

  it("never moves back to processing", () => {
    expect(canMove("awaiting_review", "processing")).toBe(false);
    expect(canMove("failed", "processing")).toBe(false);
    expect(fromStatusesFor("processing")).toEqual(["uploading"]);
  });
});
