// No "server-only" marker: the worker (plain Node, src/worker/) records usage
// too, and that package throws outside a React server build. The raw client
// import keeps this module out of browser bundles all the same.
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { UsageMetric } from "@/generated/prisma/enums";
import { rawDb } from "../db/raw";

/**
 * The usage meter (ADMIN05, NFR04): matches, video seconds, GPU cost and
 * storage bytes per organisation, recorded from v0 so pricing can be set from
 * real cost data. Nothing is charged.
 *
 * Each call records one signed delta for one source. The (organisation, metric,
 * sourceType, sourceId) key is unique, so a retried job counts once (NFR06).
 * Storage deletions are negative deltas; current storage is the sum.
 *
 * Call sites:
 * - C06: `matches` +1 when a match is created (sourceType "Match");
 *   `storage_bytes` when its upload completes and `video_seconds` when the
 *   probe accepts it (sourceType "Video", metadata.matchId); a negative
 *   `storage_bytes` when a deleted match's storage is purged (sourceType
 *   "MatchDeletion", sourceId the match id; src/worker/retention.ts).
 * - C07: `storage_bytes` for the HLS renditions (sourceType "Rendition",
 *   sourceId "{videoId}:{rendition}", metadata.matchId; src/worker/transcode.ts),
 *   netted off by the match_deleted purge.
 * - C08: `gpu_cost_cents` per cv_job, with the provider's currency (NFR04).
 * - C09: `storage_bytes` for each cut clip.
 * - C17: negative `storage_bytes` when retention deletes a file.
 *
 * Every export takes an explicit organisationId and touches only that
 * organisation's rows, so it uses the raw client (ESLint allowlist).
 */

const CURRENCIES: ReadonlySet<string> = new Set(Intl.supportedValuesOf("currency"));

export const usageInputSchema = z
  .object({
    organisationId: z.string().min(1),
    metric: z.enum(UsageMetric),
    quantity: z.union([z.number().int(), z.bigint()]),
    sourceType: z.string().trim().min(1).max(64),
    sourceId: z.string().trim().min(1).max(191),
    // ISO 4217, gpu_cost_cents only.
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .refine((c) => CURRENCIES.has(c), { error: "Unknown ISO 4217 currency" })
      .optional(),
    occurredAt: z.date().optional(),
    metadata: z.record(z.string(), z.json()).optional(),
  })
  .superRefine((v, ctx) => {
    const isMoney = v.metric === "gpu_cost_cents";
    if (isMoney && !v.currency) {
      ctx.addIssue({
        code: "custom",
        path: ["currency"],
        message: "gpu_cost_cents needs a currency",
      });
    }
    if (!isMoney && v.currency) {
      ctx.addIssue({
        code: "custom",
        path: ["currency"],
        message: `${v.metric} takes no currency`,
      });
    }
  });

export type UsageInput = z.input<typeof usageInputSchema>;

/**
 * Records one usage event. Returns false when this source was already recorded
 * (a retry), true when a row was written. With tx, the row is written in that
 * transaction, so it commits with the work it measures.
 */
export async function recordUsage(
  input: UsageInput,
  tx?: Prisma.TransactionClient,
): Promise<boolean> {
  const v = usageInputSchema.parse(input);
  const db = tx ?? rawDb;
  const { count } = await db.usageEvent.createMany({
    data: [
      {
        organisationId: v.organisationId,
        metric: v.metric,
        quantity: BigInt(v.quantity),
        currency: v.currency ?? null,
        sourceType: v.sourceType,
        sourceId: v.sourceId,
        metadata: (v.metadata ?? {}) as Prisma.InputJsonValue,
        ...(v.occurredAt && { occurredAt: v.occurredAt }),
      },
    ],
    skipDuplicates: true,
  });
  return count === 1;
}

export type UsageTotals = {
  matches: bigint;
  video_seconds: bigint;
  storage_bytes: bigint;
  /** GPU cost in cents per ISO 4217 currency; no exchange-rate conversion. */
  gpu_cost_cents: Record<string, bigint>;
};

/**
 * Net usage per metric for events in [from, to). Signed deltas are summed, so
 * storage deletions net off. For the C18 usage report.
 */
export async function usageTotals(
  organisationId: string,
  { from, to }: { from: Date; to: Date },
): Promise<UsageTotals> {
  const groups = await rawDb.usageEvent.groupBy({
    by: ["metric", "currency"],
    where: { organisationId, occurredAt: { gte: from, lt: to } },
    _sum: { quantity: true },
  });
  const totals: UsageTotals = {
    matches: BigInt(0),
    video_seconds: BigInt(0),
    storage_bytes: BigInt(0),
    gpu_cost_cents: {},
  };
  for (const g of groups) {
    const sum = g._sum.quantity ?? BigInt(0);
    if (g.metric === "gpu_cost_cents") {
      const currency = g.currency ?? "unknown";
      totals.gpu_cost_cents[currency] = (totals.gpu_cost_cents[currency] ?? BigInt(0)) + sum;
    } else {
      totals[g.metric] += sum;
    }
  }
  return totals;
}

/**
 * Net storage_bytes recorded for one match: every row whose metadata.matchId
 * is this match, deletions included. The retention worker records the
 * negative of this when it purges a deleted match (C06). Raw SQL, filtered by
 * organisationId by hand.
 */
export async function storageBytesForMatch(
  organisationId: string,
  matchId: string,
): Promise<bigint> {
  const rows = await rawDb.$queryRaw<{ total: bigint | null }[]>`
    SELECT SUM("quantity")::bigint AS total
    FROM "UsageEvent"
    WHERE "organisationId" = ${organisationId}
      AND "metric" = 'storage_bytes'
      AND "metadata"->>'matchId' = ${matchId}`;
  return rows[0]?.total ?? BigInt(0);
}
