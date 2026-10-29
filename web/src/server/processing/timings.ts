import "server-only";
import type { ProcessingJobType } from "@/generated/prisma/enums";
import { rawDb } from "../db/raw";
import type { FactorSample, ProcessingTimings } from "../matches/estimate";

/** How many recent jobs the median is taken over. */
const SAMPLE_SIZE = 20;

/**
 * The median realtime factor (job time / footage length) of the last 20
 * succeeded jobs of one type, platform-wide, for estimatedReadyAt() (MATCH07).
 * Transcodes record encode time (C07); CV jobs record the instance's run time
 * (C08). Aggregate only: no row, id or organisation leaves this function, so
 * it reads through the raw client (ESLint allowlist). Null with no samples.
 */
async function medianFactor(type: ProcessingJobType): Promise<FactorSample | null> {
  const rows = await rawDb.$queryRaw<{ median: number | null; samples: bigint }[]>`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY f) AS median, count(*)::bigint AS samples
    FROM (
      SELECT ("metadata"->>'realtimeFactor')::float8 AS f
      FROM "ProcessingJob"
      WHERE "type" = ${type}::"ProcessingJobType"
        AND "status" = 'succeeded'
        AND jsonb_typeof("metadata"->'realtimeFactor') = 'number'
      ORDER BY "finishedAt" DESC
      LIMIT ${SAMPLE_SIZE}
    ) recent`;
  const row = rows[0];
  if (!row || row.median === null) return null;
  return { factor: Number(row.median), samples: Number(row.samples) };
}

export function transcodeTimings(): Promise<FactorSample | null> {
  return medianFactor("transcode");
}

export function cvTimings(): Promise<FactorSample | null> {
  return medianFactor("cv");
}

export async function processingTimings(): Promise<ProcessingTimings> {
  const [transcode, cv] = await Promise.all([transcodeTimings(), cvTimings()]);
  return { transcode, cv };
}
