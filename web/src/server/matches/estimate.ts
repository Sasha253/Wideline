// The estimated finish shown while a match is Processing (MATCH07;
// docs/build/design/C06.md, Surfaces 1 and 6). Draft constants: C07 and C08
// refine them from measured ProcessingJob timings.

/** The least time processing takes, whatever the footage length. */
export const PROCESSING_FLOOR_MS = 30 * 60 * 1000;

/** Processing takes about this many times the footage length. */
export const PROCESSING_FACTOR = 2;

/**
 * probedAt + max(30 min, duration x 2), or null before the probe has run.
 */
export function estimatedReadyAt(video: {
  probedAt: Date | null;
  durationSec: number | null;
}): Date | null {
  if (!video.probedAt) return null;
  const work = Math.max(PROCESSING_FLOOR_MS, (video.durationSec ?? 0) * 1000 * PROCESSING_FACTOR);
  return new Date(video.probedAt.getTime() + work);
}
