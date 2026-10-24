-- C06: database rules for matches, lineups and footage that Prisma cannot
-- declare. The app checks each one first, for the message; these make sure no
-- path (a script, a race, a later chunk) can store a broken row.

-- MATCH01: a match is between two different teams.
ALTER TABLE "Match" ADD CONSTRAINT "Match_home_ne_away"
  CHECK ("homeTeamId" <> "awayTeamId");

-- Youth halves run from 10 to 60 minutes (src/server/matches/fields.ts).
ALTER TABLE "Match" ADD CONSTRAINT "Match_halfLength_range"
  CHECK ("halfLengthMinutes" BETWEEN 10 AND 60);

-- SQUAD06: on and off times are match seconds; a player goes off after they
-- came on (a starter came on at 0).
ALTER TABLE "Lineup" ADD CONSTRAINT "Lineup_times_valid"
  CHECK (
    ("startedAt" IS NULL OR "startedAt" >= 0)
    AND ("endedAt" IS NULL OR "endedAt" > COALESCE("startedAt", 0))
  );

-- MATCH02: an upload has a size.
ALTER TABLE "Video" ADD CONSTRAINT "Video_size_positive"
  CHECK ("sizeBytes" > 0 AND "partSize" > 0);

-- MATCH05: kickoff < half-time <= second-half kickoff < full time, among the
-- markers that are set; every marker is a non-negative video offset.
ALTER TABLE "Video" ADD CONSTRAINT "Video_markers_ordered"
  CHECK (
    ("kickoffMs" IS NULL OR "kickoffMs" >= 0)
    AND ("halfTimeMs" IS NULL OR "halfTimeMs" >= 0)
    AND ("secondHalfKickoffMs" IS NULL OR "secondHalfKickoffMs" >= 0)
    AND ("fullTimeMs" IS NULL OR "fullTimeMs" >= 0)
    AND ("kickoffMs" IS NULL OR "halfTimeMs" IS NULL OR "kickoffMs" < "halfTimeMs")
    AND ("kickoffMs" IS NULL OR "secondHalfKickoffMs" IS NULL OR "kickoffMs" < "secondHalfKickoffMs")
    AND ("kickoffMs" IS NULL OR "fullTimeMs" IS NULL OR "kickoffMs" < "fullTimeMs")
    AND ("halfTimeMs" IS NULL OR "secondHalfKickoffMs" IS NULL OR "halfTimeMs" <= "secondHalfKickoffMs")
    AND ("halfTimeMs" IS NULL OR "fullTimeMs" IS NULL OR "halfTimeMs" < "fullTimeMs")
    AND ("secondHalfKickoffMs" IS NULL OR "fullTimeMs" IS NULL OR "secondHalfKickoffMs" < "fullTimeMs")
  );
