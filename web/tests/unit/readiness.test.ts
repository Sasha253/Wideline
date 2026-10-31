import { describe, expect, it } from "vitest";
import { reviewReadyDuration } from "@/server/lab/timings";
import { moveToAwaitingReviewIfReady, REQUIRED_JOB_TYPES } from "@/server/processing/readiness";

// C09 (A-12, NFR01): a match is review-ready once its transcode, cv and clips
// jobs have succeeded; the Lab measures upload to review-ready.

describe("REQUIRED_JOB_TYPES", () => {
  it("needs the transcode, the cv job and the clips", () => {
    expect([...REQUIRED_JOB_TYPES].sort()).toEqual(["clips", "cv", "transcode"]);
  });
});

describe("reviewReadyDuration", () => {
  const up = new Date("2026-10-28T10:00:00Z");
  const at = (min: number) => new Date(up.getTime() + min * 60_000);
  const job = (type: "transcode" | "cv" | "clips", min: number | null) => ({
    type,
    status: min === null ? ("running" as const) : ("succeeded" as const),
    finishedAt: min === null ? null : at(min),
  });

  it("is the last required job's finish minus the upload", () => {
    expect(reviewReadyDuration(up, [job("transcode", 50), job("cv", 90), job("clips", 95)])).toBe(
      95 * 60,
    );
  });

  it("is null until every required job has succeeded", () => {
    expect(reviewReadyDuration(up, [job("transcode", 50), job("cv", 90)])).toBeNull();
    expect(
      reviewReadyDuration(up, [job("transcode", 50), job("cv", 90), job("clips", null)]),
    ).toBeNull();
    expect(
      reviewReadyDuration(null, [job("transcode", 1), job("cv", 1), job("clips", 1)]),
    ).toBeNull();
  });
});

// C10 (A-18): the readiness move starts only from Processing, so a late job
// success (a clips backfill, a watchdog repair) never pulls a match out of
// review, even though In review may now move back to Awaiting review.
describe("moveToAwaitingReviewIfReady", () => {
  function fakeTx(count: number) {
    const updates: unknown[] = [];
    const tx = {
      $queryRaw: async () => [],
      processingJob: {
        findMany: async () =>
          REQUIRED_JOB_TYPES.map((type) => ({ type, status: "succeeded" as const })),
      },
      match: {
        updateMany: async (args: unknown) => {
          updates.push(args);
          return { count };
        },
      },
    };
    return { tx: tx as never, updates };
  }
  const ids = { organisationId: "o1", matchId: "m1", videoId: "v1" };

  it("moves only from processing", async () => {
    const { tx, updates } = fakeTx(1);
    await expect(moveToAwaitingReviewIfReady(tx, ids)).resolves.toBe(true);
    expect(updates).toEqual([
      {
        where: { id: "m1", organisationId: "o1", status: "processing" },
        data: { status: "awaiting_review" },
      },
    ]);
  });

  it("reports no move when the match is not in processing (in review, say)", async () => {
    const { tx } = fakeTx(0);
    await expect(moveToAwaitingReviewIfReady(tx, ids)).resolves.toBe(false);
  });
});
