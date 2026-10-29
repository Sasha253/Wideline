-- C09: clips (CV11), favourites, pitch calibrations (CV05) and Lab ground
-- truth; Track.distanceM (CV08) and Video.pitchCalibrationId. CHECKs and the
-- favourite triggers are in c09_clips_rules.
-- CreateEnum
CREATE TYPE "CalibrationSource" AS ENUM ('fallback', 'auto', 'manual');

-- CreateEnum
CREATE TYPE "BenchmarkTagSource" AS ENUM ('hand', 'synthetic', 'soccernet');

-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "distanceM" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "pitchCalibrationId" TEXT;

-- CreateTable
CREATE TABLE "PitchCalibration" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "venueKey" TEXT,
    "cameraKey" TEXT NOT NULL,
    "homography" JSONB NOT NULL,
    "imageWidth" INTEGER NOT NULL,
    "imageHeight" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" "CalibrationSource" NOT NULL,
    "pointCount" INTEGER,
    "reprojectionErrorM" DOUBLE PRECISION,
    "sourceVideoId" TEXT,
    "calibratedByUserId" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PitchCalibration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clip" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "processingJobId" TEXT,
    "blobPath" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "baseExpiresAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Clip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipFavourite" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipFavourite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkTag" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "timestampMs" INTEGER NOT NULL,
    "teamSide" "TeamSide",
    "onTarget" BOOLEAN,
    "source" "BenchmarkTagSource" NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenchmarkTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PitchCalibration_organisationId_venueKey_cameraKey_idx" ON "PitchCalibration"("organisationId", "venueKey", "cameraKey");

-- CreateIndex
CREATE UNIQUE INDEX "PitchCalibration_organisationId_id_key" ON "PitchCalibration"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PitchCalibration_current_manual_key" ON "PitchCalibration"("organisationId", "venueKey", "cameraKey") WHERE (("supersededAt" IS NULL) AND (source = 'manual'::"CalibrationSource") AND ("venueKey" IS NOT NULL));

-- CreateIndex
CREATE INDEX "Clip_organisationId_matchId_idx" ON "Clip"("organisationId", "matchId");

-- CreateIndex
CREATE INDEX "Clip_expiry_idx" ON "Clip"("expiresAt") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "Clip_organisationId_id_key" ON "Clip"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Clip_organisationId_eventId_key" ON "Clip"("organisationId", "eventId");

-- CreateIndex
CREATE INDEX "ClipFavourite_userId_idx" ON "ClipFavourite"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ClipFavourite_clipId_userId_key" ON "ClipFavourite"("clipId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ClipFavourite_organisationId_id_key" ON "ClipFavourite"("organisationId", "id");

-- CreateIndex
CREATE INDEX "BenchmarkTag_organisationId_matchId_type_idx" ON "BenchmarkTag"("organisationId", "matchId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkTag_organisationId_id_key" ON "BenchmarkTag"("organisationId", "id");

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_organisationId_pitchCalibrationId_fkey" FOREIGN KEY ("organisationId", "pitchCalibrationId") REFERENCES "PitchCalibration"("organisationId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PitchCalibration" ADD CONSTRAINT "PitchCalibration_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_organisationId_matchId_fkey" FOREIGN KEY ("organisationId", "matchId") REFERENCES "Match"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_organisationId_eventId_fkey" FOREIGN KEY ("organisationId", "eventId") REFERENCES "Event"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_organisationId_processingJobId_fkey" FOREIGN KEY ("organisationId", "processingJobId") REFERENCES "ProcessingJob"("organisationId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ClipFavourite" ADD CONSTRAINT "ClipFavourite_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipFavourite" ADD CONSTRAINT "ClipFavourite_organisationId_clipId_fkey" FOREIGN KEY ("organisationId", "clipId") REFERENCES "Clip"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipFavourite" ADD CONSTRAINT "ClipFavourite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkTag" ADD CONSTRAINT "BenchmarkTag_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkTag" ADD CONSTRAINT "BenchmarkTag_organisationId_matchId_fkey" FOREIGN KEY ("organisationId", "matchId") REFERENCES "Match"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
