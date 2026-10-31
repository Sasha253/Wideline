-- CreateEnum
CREATE TYPE "ReviewClaimStatus" AS ENUM ('active', 'submitted', 'released', 'expired');

-- CreateEnum
CREATE TYPE "ReviewReleaseReason" AS ENUM ('scout', 'suspended', 'conflict', 'no_profile', 'admin');

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "reviewAlertedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ReviewClaim" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "scoutUserId" TEXT NOT NULL,
    "status" "ReviewClaimStatus" NOT NULL DEFAULT 'active',
    "claimedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "releaseReason" "ReviewReleaseReason",
    "eventsReviewed" INTEGER NOT NULL DEFAULT 0,
    "corrections" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewClaim_scoutUserId_status_idx" ON "ReviewClaim"("scoutUserId", "status");

-- CreateIndex
CREATE INDEX "ReviewClaim_status_expiresAt_idx" ON "ReviewClaim"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ReviewClaim_organisationId_matchId_idx" ON "ReviewClaim"("organisationId", "matchId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewClaim_organisationId_id_key" ON "ReviewClaim"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewClaim_match_active_key" ON "ReviewClaim"("matchId") WHERE (status = 'active'::"ReviewClaimStatus");

-- CreateIndex
CREATE INDEX "Video_rawExpiresAt_idx" ON "Video"("rawExpiresAt");

-- AddForeignKey
ALTER TABLE "ReviewClaim" ADD CONSTRAINT "ReviewClaim_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewClaim" ADD CONSTRAINT "ReviewClaim_organisationId_matchId_fkey" FOREIGN KEY ("organisationId", "matchId") REFERENCES "Match"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewClaim" ADD CONSTRAINT "ReviewClaim_organisationId_videoId_fkey" FOREIGN KEY ("organisationId", "videoId") REFERENCES "Video"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
