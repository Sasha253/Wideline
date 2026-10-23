/*
  Warnings:

  - You are about to drop the column `planId` on the `Organisation` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'past_due', 'cancelled', 'lapsed');

-- CreateEnum
CREATE TYPE "EntitlementSource" AS ENUM ('override', 'flag');

-- CreateEnum
CREATE TYPE "UsageMetric" AS ENUM ('matches', 'video_seconds', 'gpu_cost_cents', 'storage_bytes');

-- AlterTable
ALTER TABLE "Organisation" DROP COLUMN "planId";

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "limits" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "provider" TEXT,
    "providerRef" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entitlement" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" "EntitlementSource" NOT NULL,
    "value" JSONB NOT NULL,
    "reason" TEXT,
    "setByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "metric" "UsageMetric" NOT NULL,
    "quantity" BIGINT NOT NULL,
    "currency" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organisationId_key" ON "Subscription"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organisationId_id_key" ON "Subscription"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Entitlement_organisationId_key_source_key" ON "Entitlement"("organisationId", "key", "source");

-- CreateIndex
CREATE UNIQUE INDEX "Entitlement_organisationId_id_key" ON "Entitlement"("organisationId", "id");

-- CreateIndex
CREATE INDEX "UsageEvent_organisationId_metric_occurredAt_idx" ON "UsageEvent"("organisationId", "metric", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageEvent_organisationId_metric_sourceType_sourceId_key" ON "UsageEvent"("organisationId", "metric", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageEvent_organisationId_id_key" ON "UsageEvent"("organisationId", "id");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- C03 (hand-written, appended before the first apply).

-- The usage meter records a currency for GPU cost only (NFR04). Prisma does not
-- model check constraints; src/server/usage/meter.ts validates the same rule.
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_currency_gpu_only"
    CHECK (("metric" = 'gpu_cost_cents') = ("currency" IS NOT NULL));

-- BILL02: the pilot plan, free, with generous draft limits. Keep in step with
-- PILOT_PLAN_LIMITS in src/server/entitlements/plans.ts. Changing the numbers
-- later is a new data migration that updates this row.
INSERT INTO "Plan" ("id", "code", "name", "priceCents", "currency", "limits", "createdAt", "updatedAt")
VALUES (
    'plan-pilot',
    'pilot',
    'Pilot',
    0,
    'ZAR',
    '{"matches_per_month": 100, "favourited_clips": 10000, "member_seats": 100, "scout_seats": 50, "upload_max_bytes": 8589934592, "billing": false, "scout_search": false, "share_links": false, "scout_reports": false}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- Every existing organisation goes on the pilot plan.
INSERT INTO "Subscription" ("id", "organisationId", "planId", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'plan-pilot', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organisation";
