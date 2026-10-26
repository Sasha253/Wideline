-- CreateEnum
CREATE TYPE "ProcessingJobType" AS ENUM ('transcode', 'clips', 'cv');

-- CreateEnum
CREATE TYPE "ProcessingJobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "videoId" TEXT,
    "type" "ProcessingJobType" NOT NULL,
    "status" "ProcessingJobStatus" NOT NULL DEFAULT 'queued',
    "bossJobId" UUID NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "modelVersion" TEXT,
    "gpuProvider" TEXT,
    "costCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingJob_bossJobId_key" ON "ProcessingJob"("bossJobId");

-- CreateIndex
CREATE INDEX "ProcessingJob_organisationId_matchId_idx" ON "ProcessingJob"("organisationId", "matchId");

-- CreateIndex
CREATE INDEX "ProcessingJob_type_status_finishedAt_idx" ON "ProcessingJob"("type", "status", "finishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingJob_organisationId_id_key" ON "ProcessingJob"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingJob_transcode_video_key" ON "ProcessingJob"("videoId") WHERE (type = 'transcode'::"ProcessingJobType");

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_organisationId_matchId_fkey" FOREIGN KEY ("organisationId", "matchId") REFERENCES "Match"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_organisationId_videoId_fkey" FOREIGN KEY ("organisationId", "videoId") REFERENCES "Video"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- C07: database rules for processing jobs that Prisma cannot declare. The
-- service (src/server/processing/jobs.ts) keeps to them; these make sure no
-- path (a retry race, a script, a later chunk) can store a broken row.

-- NFR30: a job runs at most maxAttempts times.
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_attempts_range"
  CHECK ("attempts" BETWEEN 0 AND "maxAttempts");

-- A job finishes after it starts.
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_times_ordered"
  CHECK ("finishedAt" IS NULL OR "startedAt" IS NULL OR "finishedAt" >= "startedAt");

-- NFR31: a failed job says why.
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_failed_has_error"
  CHECK ("status" <> 'failed' OR "errorMessage" IS NOT NULL);
