// The estimated finish shown while a match is Processing (MATCH07;
// docs/build/design/C06.md, Surfaces 1 and 6). C06 set draft constants; C07
// uses the measured transcode speed once there are enough samples, and C08 the
// measured CV speed (src/server/processing/timings.ts). The transcode and CV
// jobs run in parallel, so the slower of the two sets the finish.

/** The least time processing takes, whatever the footage length. */
export const PROCESSING_FLOOR_MS = 30 * 60 * 1000;

/** Processing takes about this many times the footage length (transcode and CV, unmeasured). */
export const PROCESSING_FACTOR = 2;

/** CV time per second of footage, until enough CV jobs are measured. Draft. */
export const CV_FACTOR_DRAFT = 1.5;

/** Measured timings are used from this many samples. */
export const MIN_TIMING_SAMPLES = 5;

/** A platform-wide median time per second of footage, and how many jobs it comes from. */
export type FactorSample = { factor: number; samples: number };

/** Measured transcode and CV speeds, each null with no samples. */
export type ProcessingTimings = { transcode: FactorSample | null; cv: FactorSample | null };

const measured = (s: FactorSample | null | undefined) =>
  s && s.samples >= MIN_TIMING_SAMPLES ? s.factor : null;

/**
 * probedAt + max(30 min, duration x factor), or null before the probe has run.
 * With neither speed measured (5 or more samples), the factor is
 * PROCESSING_FACTOR. Otherwise it is the larger of the two, since the jobs run
 * in parallel: the measured transcode factor (else PROCESSING_FACTOR) and the
 * measured CV factor (else CV_FACTOR_DRAFT).
 */
export function estimatedReadyAt(
  video: { probedAt: Date | null; durationSec: number | null },
  timings?: ProcessingTimings | null,
): Date | null {
  if (!video.probedAt) return null;
  const transcode = measured(timings?.transcode);
  const cv = measured(timings?.cv);
  const factor =
    transcode === null && cv === null
      ? PROCESSING_FACTOR
      : Math.max(transcode ?? PROCESSING_FACTOR, cv ?? CV_FACTOR_DRAFT);
  const work = Math.max(PROCESSING_FLOOR_MS, (video.durationSec ?? 0) * 1000 * factor);
  return new Date(video.probedAt.getTime() + work);
}
