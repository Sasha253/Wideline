-- CreateEnum
CREATE TYPE "EventPlayerSource" AS ENUM ('track', 'reviewer');

-- CreateEnum
CREATE TYPE "EventCorrectionKind" AS ENUM ('confirmed', 'rejected', 'edited', 'reassigned', 'relinked', 'added', 'sides_swapped');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "playerSource" "EventPlayerSource";

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EventCorrection" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "correctedByUserId" TEXT NOT NULL,
    "kind" "EventCorrectionKind" NOT NULL,
    "previousValue" JSONB NOT NULL,
    "newValue" JSONB NOT NULL,
    "previousPlayerId" TEXT,
    "newPlayerId" TEXT,
    "correctedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventCorrection_organisationId_matchId_idx" ON "EventCorrection"("organisationId", "matchId");

-- CreateIndex
CREATE INDEX "EventCorrection_claimId_kind_idx" ON "EventCorrection"("claimId", "kind");

-- CreateIndex
CREATE INDEX "EventCorrection_eventId_idx" ON "EventCorrection"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventCorrection_organisationId_id_key" ON "EventCorrection"("organisationId", "id");

-- AddForeignKey
ALTER TABLE "EventCorrection" ADD CONSTRAINT "EventCorrection_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCorrection" ADD CONSTRAINT "EventCorrection_organisationId_matchId_fkey" FOREIGN KEY ("organisationId", "matchId") REFERENCES "Match"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCorrection" ADD CONSTRAINT "EventCorrection_organisationId_eventId_fkey" FOREIGN KEY ("organisationId", "eventId") REFERENCES "Event"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCorrection" ADD CONSTRAINT "EventCorrection_organisationId_claimId_fkey" FOREIGN KEY ("organisationId", "claimId") REFERENCES "ReviewClaim"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
