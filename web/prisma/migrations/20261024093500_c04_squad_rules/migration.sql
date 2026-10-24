-- C04 review: database rules for the squad.

-- A squad number needs a team. The partial unique index
-- "Player_team_squadNumber_active_key" only compares rows with a teamId, so a
-- numbered player with no team would escape it.
ALTER TABLE "Player" ADD CONSTRAINT "Player_squadNumber_needs_team"
  CHECK ("squadNumber" IS NULL OR "teamId" IS NOT NULL);

-- A team name is unique per organisation and season ignoring case, as the app
-- checks it (src/server/squad/teams.ts). Prisma cannot express an expression
-- index, so schema.prisma has no @@unique for it and points here.
-- DropIndex
DROP INDEX "Team_organisationId_name_season_key";

-- CreateIndex
CREATE UNIQUE INDEX "Team_organisationId_lower_name_season_key"
  ON "Team" ("organisationId", lower("name"), "season");
