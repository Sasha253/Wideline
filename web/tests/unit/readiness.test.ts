import { describe, expect, it } from "vitest";
import { reviewReadyDuration } from "@/server/lab/timings";
import { REQUIRED_JOB_TYPES } from "@/server/processing/readiness";

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
