// No "server-only" import: prisma/seed.ts runs this under plain Node.
import type { Prisma } from "@/generated/prisma/client";
import type { EntitlementKey } from "@/lib/entitlement-keys";

/**
 * The pilot plan (BILL02): every pilot organisation runs on it, free, with
 * generous limits. The c03_entitlements migration seeded the row and gave every
 * organisation that existed then a subscription; ensurePilotPlan and
 * ensureSubscription cover new organisations (/apply, the scout network, the
 * seed).
 *
 * Draft values: the PRD says "effectively unmetered", and nothing is enforced
 * until V201 (BILL05). Changing them is a data migration that updates the Plan
 * row's limits, plus this constant.
 */

export const PILOT_PLAN_CODE = "pilot";
export const PILOT_PLAN_ID = "plan-pilot";
export const PILOT_PLAN_NAME = "Pilot";

export const PILOT_PLAN_LIMITS = {
  matches_per_month: 100,
  favourited_clips: 10_000,
  member_seats: 100,
  scout_seats: 50,
  // 8 GiB, the C06 upload cap.
  upload_max_bytes: 8_589_934_592,
  // C10 (Q-050): the c10_review_rules migration wrote it to the plan row.
  review_claims_active: 1,
  billing: false,
  scout_search: false,
  share_links: false,
  scout_reports: false,
} as const satisfies Record<EntitlementKey, number | boolean | "unlimited">;

// The raw client or an interactive transaction client.
type Db = Pick<Prisma.TransactionClient, "plan" | "subscription">;

/**
 * Creates the pilot plan if it is missing and returns its id. Never overwrites
 * an existing row: the migrations own its limits. Insert-or-ignore, so it is
 * safe to race and safe inside a transaction (no unique violation aborts it).
 */
export async function ensurePilotPlan(db: Db): Promise<string> {
  await db.plan.createMany({
    data: [
      {
        id: PILOT_PLAN_ID,
        code: PILOT_PLAN_CODE,
        name: PILOT_PLAN_NAME,
        priceCents: 0,
        currency: "ZAR",
        limits: PILOT_PLAN_LIMITS,
      },
    ],
    skipDuplicates: true,
  });
  const plan = await db.plan.findUniqueOrThrow({
    where: { code: PILOT_PLAN_CODE },
    select: { id: true },
  });
  return plan.id;
}

/**
 * Puts an organisation on the pilot plan unless it already has a subscription.
 * Idempotent, race-safe and transaction-safe, like ensurePilotPlan.
 */
export async function ensureSubscription(db: Db, organisationId: string): Promise<void> {
  const planId = await ensurePilotPlan(db);
  await db.subscription.createMany({
    data: [{ organisationId, planId, status: "active" }],
    skipDuplicates: true,
  });
}
