import "server-only";
import { rawDb } from "../db/raw";
import type { ProcessingTimings } from "../matches/estimate";

/** How many recent transcodes the median is taken over. */
const SAMPLE_SIZE = 20;

/**
 * The median transcode realtime factor (encode time / footage length) of the
 * last 20 succeeded transcode jobs, platform-wide, for estimatedReadyAt()
 * (MATCH07). Aggregate only: no row, id or organisation leaves this function,
 * so it reads through the raw client (ESLint allowlist). Null with no samples.
 */
export async function transcodeTimings(): Promise<ProcessingTimings | null> {
  const rows = await rawDb.$queryRaw<{ median: number | null; samples: bigint }[]>`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY f) AS median, count(*)::bigint AS samples
    FROM (
      SELECT ("metadata"->>'realtimeFactor')::float8 AS f
      FROM "ProcessingJob"
      WHERE "type" = 'transcode'
        AND "status" = 'succeeded'
        AND jsonb_typeof("metadata"->'realtimeFactor') = 'number'
      ORDER BY "finishedAt" DESC
      LIMIT ${SAMPLE_SIZE}
    ) recent`;
  const row = rows[0];
  if (!row || row.median === null) return null;
  return { transcodeFactor: Number(row.median), samples: Number(row.samples) };
}
