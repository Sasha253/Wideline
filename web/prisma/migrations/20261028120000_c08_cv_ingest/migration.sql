-- CreateEnum
CREATE TYPE "TeamSide" AS ENUM ('home', 'away', 'unknown');

-- CreateEnum
CREATE TYPE "TrackLinkSource" AS ENUM ('cv', 'reviewer');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('goal', 'shot');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('auto_accepted', 'pending_review', 'confirmed', 'rejected', 'manual');

-- CreateEnum
CREATE TYPE "GpuInstanceStatus" AS ENUM ('requested', 'running', 'destroying', 'destroyed', 'failed_to_start');

-- DropIndex
DROP INDEX "ProcessingJob_transcode_video_key";

-- AlterTable
ALTER TABLE "ProcessingJob" ADD COLUMN     "alertedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "trackIndex" INTEGER NOT NULL,
    "teamSide" "TeamSide" NOT NULL,
    "shirtNumber" INTEGER,
    "shirtConfidence" DOUBLE PRECISION,
    "playerId" TEXT,
    "linkConfidence" DOUBLE PRECISION,
    "linkedBy" "TrackLinkSource",
    "linkedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackPoint" (
    "organisationId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "tMs" INTEGER NOT NULL,
    "x" REAL NOT NULL,
    "y" REAL NOT NULL,

    CONSTRAINT "TrackPoint_pkey" PRIMARY KEY ("matchId","trackId","tMs")
) PARTITION BY HASH ("matchId");

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "jobId" TEXT,
    "sourceKey" TEXT,
    "type" "EventType" NOT NULL,
    "status" "EventStatus" NOT NULL,
    "teamSide" "TeamSide",
    "trackId" TEXT,
    "playerId" TEXT,
    "timestampMs" INTEGER NOT NULL,
    "pitchX" DOUBLE PRECISION,
    "pitchY" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "onTarget" BOOLEAN,
    "clipStartMs" INTEGER,
    "clipEndMs" INTEGER,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GpuInstance" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "processingJobId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "providerInstanceId" TEXT,
    "status" "GpuInstanceStatus" NOT NULL DEFAULT 'requested',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "resultStatus" TEXT,
    "resultAt" TIMESTAMP(3),
    "resultError" TEXT,
    "resultSha256" TEXT,
    "jobSettledAt" TIMESTAMP(3),
    "destroyedAt" TIMESTAMP(3),
    "destroyReason" TEXT,
    "centsPerHour" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "billedSeconds" INTEGER,
    "costCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GpuInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Track_organisationId_matchId_idx" ON "Track"("organisationId", "matchId");

-- CreateIndex
CREATE INDEX "Track_playerId_idx" ON "Track"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "Track_organisationId_id_key" ON "Track"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Track_jobId_trackIndex_key" ON "Track"("jobId", "trackIndex");

-- CreateIndex
CREATE INDEX "Event_organisationId_matchId_status_idx" ON "Event"("organisationId", "matchId", "status");

-- CreateIndex
CREATE INDEX "Event_trackId_idx" ON "Event"("trackId");

-- CreateIndex
CREATE INDEX "Event_playerId_idx" ON "Event"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_organisationId_id_key" ON "Event"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Event_jobId_sourceKey_key" ON "Event"("jobId", "sourceKey");

-- CreateIndex
CREATE INDEX "GpuInstance_status_idx" ON "GpuInstance"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GpuInstance_processingJobId_attempt_key" ON "GpuInstance"("processingJobId", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "GpuInstance_organisationId_id_key" ON "GpuInstance"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingJob_video_type_key" ON "ProcessingJob"("videoId", "type");

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_organisationId_matchId_fkey" FOREIGN KEY ("organisationId", "matchId") REFERENCES "Match"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_organisationId_jobId_fkey" FOREIGN KEY ("organisationId", "jobId") REFERENCES "ProcessingJob"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_organisationId_playerId_fkey" FOREIGN KEY ("organisationId", "playerId") REFERENCES "Player"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackPoint" ADD CONSTRAINT "TrackPoint_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackPoint" ADD CONSTRAINT "TrackPoint_organisationId_matchId_fkey" FOREIGN KEY ("organisationId", "matchId") REFERENCES "Match"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackPoint" ADD CONSTRAINT "TrackPoint_organisationId_trackId_fkey" FOREIGN KEY ("organisationId", "trackId") REFERENCES "Track"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_organisationId_matchId_fkey" FOREIGN KEY ("organisationId", "matchId") REFERENCES "Match"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_organisationId_jobId_fkey" FOREIGN KEY ("organisationId", "jobId") REFERENCES "ProcessingJob"("organisationId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_organisationId_trackId_fkey" FOREIGN KEY ("organisationId", "trackId") REFERENCES "Track"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_organisationId_playerId_fkey" FOREIGN KEY ("organisationId", "playerId") REFERENCES "Player"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpuInstance" ADD CONSTRAINT "GpuInstance_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written (C08). Prisma cannot declare these.
-- ---------------------------------------------------------------------------

-- TrackPoint partitions (about 600,000 rows per match). Hash on matchId, so
-- every match's points sit in one partition and no DDL runs at ingest. The
-- children live outside "public", so Prisma introspection and migrate diff see
-- only the parent.
CREATE SCHEMA IF NOT EXISTS trackpoint_parts;
DO $$
BEGIN
  FOR i IN 0..15 LOOP
    EXECUTE format(
      'CREATE TABLE trackpoint_parts.p%s PARTITION OF "TrackPoint" FOR VALUES WITH (MODULUS 16, REMAINDER %s)',
      lpad(i::text, 2, '0'),
      i
    );
  END LOOP;
END $$;

ALTER TABLE "TrackPoint" ADD CONSTRAINT "TrackPoint_coords"
  CHECK ("tMs" >= 0 AND "x" BETWEEN 0 AND 105 AND "y" BETWEEN 0 AND 68);

ALTER TABLE "Track" ADD CONSTRAINT "Track_values"
  CHECK (
    "trackIndex" >= 0
    AND ("shirtNumber" IS NULL OR "shirtNumber" BETWEEN 0 AND 99)
    AND ("shirtConfidence" IS NULL OR "shirtConfidence" BETWEEN 0 AND 1)
    AND ("linkConfidence" IS NULL OR "linkConfidence" BETWEEN 0 AND 1)
    AND (("playerId" IS NULL) = ("linkedBy" IS NULL))
  );

ALTER TABLE "Event" ADD CONSTRAINT "Event_confidence_range"
  CHECK ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1);
ALTER TABLE "Event" ADD CONSTRAINT "Event_coords"
  CHECK (
    ("pitchX" IS NULL OR "pitchX" BETWEEN 0 AND 105)
    AND ("pitchY" IS NULL OR "pitchY" BETWEEN 0 AND 68)
  );
ALTER TABLE "Event" ADD CONSTRAINT "Event_clip_window"
  CHECK (
    "timestampMs" >= 0
    AND ("clipStartMs" IS NULL OR "clipStartMs" <= "timestampMs")
    AND ("clipEndMs" IS NULL OR "clipEndMs" >= "timestampMs")
  );
-- PRD data model: playerId is set only once the event's track is linked to
-- the player (a manual event, C11, names its player directly).
ALTER TABLE "Event" ADD CONSTRAINT "Event_player_needs_track"
  CHECK ("playerId" IS NULL OR "trackId" IS NOT NULL OR "status" = 'manual');
-- A CV event carries its identity in the result; a manual event has neither.
ALTER TABLE "Event" ADD CONSTRAINT "Event_cv_has_identity"
  CHECK (("jobId" IS NULL) = ("sourceKey" IS NULL));

ALTER TABLE "GpuInstance" ADD CONSTRAINT "GpuInstance_cost_nonneg"
  CHECK (
    "attempt" >= 1
    AND "centsPerHour" >= 0
    AND ("billedSeconds" IS NULL OR "billedSeconds" >= 0)
    AND ("costCents" IS NULL OR "costCents" >= 0)
  );
