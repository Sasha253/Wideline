-- C11: database rules for the review workspace that Prisma cannot declare.
-- The app checks each one first, for the message; these make sure no path (a
-- script, a race, a cascade) can store a broken row.

-- REVIEW04: a reviewer may give a CV event to a player on its own, without a
-- linked track ("playerSource" = 'reviewer'). Replaces the C08 rule, which
-- allowed a player only on a linked track or a manual event.
ALTER TABLE "Event" DROP CONSTRAINT "Event_player_needs_track";
ALTER TABLE "Event" ADD CONSTRAINT "Event_player_needs_track"
  CHECK ("playerId" IS NULL OR "trackId" IS NOT NULL OR "status" = 'manual'
         OR "playerSource" = 'reviewer');

-- REVIEW08: only a published match has a publication time.
ALTER TABLE "Match" ADD CONSTRAINT "Match_published_at"
  CHECK ("publishedAt" IS NULL OR "status" = 'published');

-- REVIEW09: a correction's snapshots are JSON objects.
ALTER TABLE "EventCorrection" ADD CONSTRAINT "EventCorrection_values_objects"
  CHECK (jsonb_typeof("previousValue") = 'object' AND jsonb_typeof("newValue") = 'object');
