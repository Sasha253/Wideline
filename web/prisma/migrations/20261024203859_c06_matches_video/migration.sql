/*
  Warnings:

  - A unique constraint covering the columns `[organisationId,id]` on the table `Lineup` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('uploading', 'probing', 'accepted', 'rejected', 'cancelled');

-- AlterTable
ALTER TABLE "Lineup" ADD COLUMN     "replacesLineupId" TEXT;

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "halfLengthMinutes" INTEGER NOT NULL DEFAULT 45;

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "status" "VideoStatus" NOT NULL DEFAULT 'uploading',
    "blobPath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "partSize" INTEGER NOT NULL,
    "s3UploadId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "uploadStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedAt" TIMESTAMP(3),
    "rawExpiresAt" TIMESTAMP(3),
    "probedAt" TIMESTAMP(3),
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "fps" DOUBLE PRECISION,
    "codec" TEXT,
    "rotation" INTEGER,
    "validation" JSONB NOT NULL DEFAULT '{}',
    "kickoffMs" INTEGER,
    "halfTimeMs" INTEGER,
    "secondHalfKickoffMs" INTEGER,
    "fullTimeMs" INTEGER,
    "hlsManifestPath" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Video_organisationId_idx" ON "Video"("organisationId");

-- CreateIndex
CREATE INDEX "Video_matchId_idx" ON "Video"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "Video_organisationId_id_key" ON "Video"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Video_match_live_key" ON "Video"("matchId") WHERE ("status" IN ('uploading', 'probing', 'accepted'));

-- CreateIndex
CREATE UNIQUE INDEX "Lineup_organisationId_id_key" ON "Lineup"("organisationId", "id");

-- AddForeignKey
ALTER TABLE "Lineup" ADD CONSTRAINT "Lineup_organisationId_replacesLineupId_fkey" FOREIGN KEY ("organisationId", "replacesLineupId") REFERENCES "Lineup"("organisationId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_organisationId_matchId_fkey" FOREIGN KEY ("organisationId", "matchId") REFERENCES "Match"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
