import { describe, expect, it } from "vitest";
import {
  CV_FACTOR_DRAFT,
  estimatedReadyAt,
  PROCESSING_FACTOR,
  PROCESSING_FLOOR_MS,
} from "@/server/matches/estimate";

// MATCH07: the estimated finish. C06 constants until 5 jobs are measured (C07
// transcodes, C08 CV jobs). The transcode and CV jobs run in parallel (C08),
// so the slower measured factor sets the finish; an unmeasured CV job counts
// as the draft CV factor.

const probedAt = new Date("2026-10-26T10:00:00Z");
const MIN = 60_000;
const at = (d: Date | null) => (d ? (d.getTime() - probedAt.getTime()) / MIN : null);
const t = (factor: number, samples: number) => ({ factor, samples });

describe("estimatedReadyAt", () => {
  it("is null before the probe", () => {
    expect(estimatedReadyAt({ probedAt: null, durationSec: 5400 })).toBeNull();
  });

  it("uses the constants without timings or with fewer than 5 samples", () => {
    const video = { probedAt, durationSec: 5400 };
    expect(at(estimatedReadyAt(video))).toBe(90 * PROCESSING_FACTOR);
    expect(at(estimatedReadyAt(video, null))).toBe(180);
    expect(at(estimatedReadyAt(video, { transcode: t(0.25, 4), cv: t(0.5, 4) }))).toBe(180);
  });

  it("takes the slower of the measured transcode and the draft CV factor", () => {
    const video = { probedAt, durationSec: 5400 };
    expect(at(estimatedReadyAt(video, { transcode: t(0.25, 5), cv: null }))).toBe(
      90 * CV_FACTOR_DRAFT,
    );
    expect(at(estimatedReadyAt(video, { transcode: t(1.8, 20), cv: null }))).toBe(90 * 1.8);
  });

  it("uses the measured CV factor once there are 5 CV samples", () => {
    const video = { probedAt, durationSec: 5400 };
    expect(at(estimatedReadyAt(video, { transcode: t(0.25, 5), cv: t(0.8, 5) }))).toBe(90 * 0.8);
    expect(at(estimatedReadyAt(video, { transcode: t(0.9, 5), cv: t(0.8, 5) }))).toBe(90 * 0.9);
    // CV measured, transcode not: the transcode counts as the C06 constant.
    expect(at(estimatedReadyAt(video, { transcode: null, cv: t(0.5, 9) }))).toBe(
      90 * PROCESSING_FACTOR,
    );
  });

  it("never goes below the floor", () => {
    const short = { probedAt, durationSec: 300 };
    const floor = PROCESSING_FLOOR_MS / MIN;
    expect(at(estimatedReadyAt(short))).toBe(floor);
    expect(at(estimatedReadyAt(short, { transcode: t(0.1, 9), cv: t(0.1, 9) }))).toBe(floor);
    expect(
      at(estimatedReadyAt({ probedAt, durationSec: null }, { transcode: t(1, 9), cv: null })),
    ).toBe(floor);
  });
});
