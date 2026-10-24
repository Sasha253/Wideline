-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "isOpposition" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Player_team_squadNumber_active_key" ON "Player"("organisationId", "teamId", "squadNumber") WHERE ("squadNumber" IS NOT NULL AND "clubStatus" = 'active');

-- CreateIndex
CREATE UNIQUE INDEX "Team_organisationId_name_season_key" ON "Team"("organisationId", "name", "season");

