-- CreateEnum
CREATE TYPE "ScoutStatus" AS ENUM ('pending', 'approved', 'rejected', 'suspended');

-- CreateEnum
CREATE TYPE "IdDocumentType" AS ENUM ('sa_id', 'passport');

-- CreateEnum
CREATE TYPE "ScoutAffiliationType" AS ENUM ('club', 'player');

-- AlterEnum
ALTER TYPE "OrganisationType" ADD VALUE 'scout_network';

-- CreateTable
CREATE TABLE "ScoutProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ScoutStatus" NOT NULL DEFAULT 'pending',
    "idDocumentType" "IdDocumentType" NOT NULL,
    "idCountry" TEXT NOT NULL,
    "idNumberHash" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "rejectionReason" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "suspensionReason" TEXT,
    "accuracyScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoutProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoutAffiliation" (
    "id" TEXT NOT NULL,
    "scoutUserId" TEXT NOT NULL,
    "type" "ScoutAffiliationType" NOT NULL,
    "name" TEXT NOT NULL,
    "clubName" TEXT,
    "organisationId" TEXT,
    "linkedAt" TIMESTAMP(3),
    "linkedById" TEXT,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "ScoutAffiliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScoutProfile_userId_key" ON "ScoutProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ScoutProfile_idNumberHash_key" ON "ScoutProfile"("idNumberHash");

-- CreateIndex
CREATE INDEX "ScoutProfile_status_createdAt_idx" ON "ScoutProfile"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ScoutAffiliation_scoutUserId_idx" ON "ScoutAffiliation"("scoutUserId");

-- CreateIndex
CREATE INDEX "ScoutAffiliation_organisationId_idx" ON "ScoutAffiliation"("organisationId");

-- AddForeignKey
ALTER TABLE "ScoutProfile" ADD CONSTRAINT "ScoutProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoutAffiliation" ADD CONSTRAINT "ScoutAffiliation_scoutUserId_fkey" FOREIGN KEY ("scoutUserId") REFERENCES "ScoutProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoutAffiliation" ADD CONSTRAINT "ScoutAffiliation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
