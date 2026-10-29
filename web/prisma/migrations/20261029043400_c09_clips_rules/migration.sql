-- C09: database rules for clips, favourites, calibrations and Lab tags that
-- Prisma cannot declare. The app checks each one first, for the message; these
-- make sure no path (a script, a race, a cascade) can store a broken row.

-- CV11: a clip covers a window of the video.
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_window"
  CHECK ("startMs" >= 0 AND "endMs" > "startMs");

ALTER TABLE "Clip" ADD CONSTRAINT "Clip_size_nonneg"
  CHECK ("sizeBytes" >= 0 AND "width" > 0 AND "height" > 0);

-- CV05: a calibration's confidence is a share.
ALTER TABLE "PitchCalibration" ADD CONSTRAINT "PitchCalibration_confidence_range"
  CHECK ("confidence" BETWEEN 0 AND 1);

-- Lab tags are video offsets.
ALTER TABLE "BenchmarkTag" ADD CONSTRAINT "BenchmarkTag_time_nonneg"
  CHECK ("timestampMs" >= 0);

-- CV08: distance covered is never negative.
ALTER TABLE "Track" ADD CONSTRAINT "Track_distance_nonneg"
  CHECK ("distanceM" IS NULL OR "distanceM" >= 0);

-- CV11: any favourite clears Clip.expiresAt, and removing the last one
-- restores baseExpiresAt. Triggers, so user and organisation cascades keep the
-- rule too. Each locks the clip row first, so concurrent favourites of one
-- clip run one after the other and the last removal always sees the others.

-- A clip whose file is gone (C17 set deletedAt) cannot be favourited.
CREATE FUNCTION "ClipFavourite_before_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  gone timestamp(3);
BEGIN
  SELECT c."deletedAt" INTO gone
    FROM "Clip" c
   WHERE c."id" = NEW."clipId" AND c."organisationId" = NEW."organisationId"
   FOR UPDATE;
  IF gone IS NOT NULL THEN
    RAISE EXCEPTION 'Clip % is deleted and cannot be favourited', NEW."clipId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ClipFavourite_before_insert"
  BEFORE INSERT ON "ClipFavourite"
  FOR EACH ROW EXECUTE FUNCTION "ClipFavourite_before_insert"();

CREATE FUNCTION "ClipFavourite_after_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Clip"
     SET "expiresAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
   WHERE "id" = NEW."clipId" AND "organisationId" = NEW."organisationId"
     AND "expiresAt" IS NOT NULL;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "ClipFavourite_after_insert"
  AFTER INSERT ON "ClipFavourite"
  FOR EACH ROW EXECUTE FUNCTION "ClipFavourite_after_insert"();

CREATE FUNCTION "ClipFavourite_after_delete"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "Clip"
    WHERE "id" = OLD."clipId" AND "organisationId" = OLD."organisationId"
    FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM "ClipFavourite" WHERE "clipId" = OLD."clipId") THEN
    UPDATE "Clip"
       SET "expiresAt" = "baseExpiresAt", "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = OLD."clipId" AND "organisationId" = OLD."organisationId"
       AND "expiresAt" IS DISTINCT FROM "baseExpiresAt";
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "ClipFavourite_after_delete"
  AFTER DELETE ON "ClipFavourite"
  FOR EACH ROW EXECUTE FUNCTION "ClipFavourite_after_delete"();
