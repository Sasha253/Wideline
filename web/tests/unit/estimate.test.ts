import { describe, expect, it } from "vitest";
import {
  CV_FACTOR_DRAFT,
  estimatedReadyAt,
  PROCESSING_FACTOR,
  PROCESSING_FLOOR_MS,
} from "@/server/matches/estimate";

// MATCH07: the estimated finish. C06 constants until 5 transcodes are measured;
// then the measured median transcode factor plus the draft CV factor (C07).

const probedAt = new Date("2026-10-26T10:00:00Z");
const MIN = 60_000;
const at = (d: Date | null) => (d ? (d.getTime() - probedAt.getTime()) / MIN : null);

describe("estimatedReadyAt", () => {
  it("is null before the probe", () => {
    expect(estimatedReadyAt({ probedAt: null, durationSec: 5400 })).toBeNull();
  });

  it("uses the constants without timings or with fewer than 5 samples", () => {
    const video = { probedAt, durationSec: 5400 };
    expect(at(estimatedReadyAt(video))).toBe(90 * PROCESSING_FACTOR);
    expect(at(estimatedReadyAt(video, null))).toBe(180);
    expect(at(estimatedReadyAt(video, { transcodeFactor: 0.25, samples: 4 }))).toBe(180);
  });

  it("uses the measured median factor with 5 or more samples", () => {
    const video = { probedAt, durationSec: 5400 };
    expect(at(estimatedReadyAt(video, { transcodeFactor: 0.25, samples: 5 }))).toBe(
      90 * (0.25 + CV_FACTOR_DRAFT),
    );
    expect(at(estimatedReadyAt(video, { transcodeFactor: 1, samples: 20 }))).toBe(225);
  });

  it("never goes below the floor", () => {
    const short = { probedAt, durationSec: 300 };
    const floor = PROCESSING_FLOOR_MS / MIN;
    expect(at(estimatedReadyAt(short))).toBe(floor);
    expect(at(estimatedReadyAt(short, { transcodeFactor: 0.1, samples: 9 }))).toBe(floor);
    expect(
      at(estimatedReadyAt({ probedAt, durationSec: null }, { transcodeFactor: 1, samples: 9 })),
    ).toBe(floor);
  });
});
