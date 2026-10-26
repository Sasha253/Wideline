// The estimated finish shown while a match is Processing (MATCH07;
// docs/build/design/C06.md, Surfaces 1 and 6). C06 set draft constants; C07
// uses the measured transcode speed once there are enough samples
// (src/server/processing/timings.ts). C08 refines the CV part from its own
// ProcessingJob timings.

/** The least time processing takes, whatever the footage length. */
export const PROCESSING_FLOOR_MS = 30 * 60 * 1000;

/** Processing takes about this many times the footage length (transcode and CV, unmeasured). */
export const PROCESSING_FACTOR = 2;

/** CV time per second of footage, until C08 measures it. Draft. */
export const CV_FACTOR_DRAFT = 1.5;

/** Measured timings are used from this many samples. */
export const MIN_TIMING_SAMPLES = 5;

/** The platform-wide median transcode time per second of footage, and how many jobs it comes from. */
export type ProcessingTimings = { transcodeFactor: number; samples: number };

/**
 * probedAt + max(30 min, duration x factor), or null before the probe has run.
 * The factor is the measured transcode factor plus CV_FACTOR_DRAFT with 5 or
 * more samples, else PROCESSING_FACTOR.
 */
export function estimatedReadyAt(
  video: { probedAt: Date | null; durationSec: number | null },
  timings?: ProcessingTimings | null,
): Date | null {
  if (!video.probedAt) return null;
  const factor =
    timings && timings.samples >= MIN_TIMING_SAMPLES
      ? timings.transcodeFactor + CV_FACTOR_DRAFT
      : PROCESSING_FACTOR;
  const work = Math.max(PROCESSING_FLOOR_MS, (video.durationSec ?? 0) * 1000 * factor);
  return new Date(video.probedAt.getTime() + work);
}
