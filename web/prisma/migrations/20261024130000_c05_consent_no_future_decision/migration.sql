-- C05 orchestrator check: the decision date that decides minority can never be
-- later than the insert, so a future-dated grantedAt cannot make a minor an adult.
CREATE OR REPLACE FUNCTION "Consent_before_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  unnamed boolean;
  dob date;
  decided date;
  age integer;
  minor boolean;
  latest timestamp(3);
  stamp timestamp(3);
BEGIN
  SELECT p."isPlaceholder" OR COALESCE(t."isOpposition", false)
    INTO unnamed
    FROM "Player" p
    LEFT JOIN "Team" t ON t."organisationId" = p."organisationId" AND t."id" = p."teamId"
   WHERE p."organisationId" = NEW."organisationId" AND p."id" = NEW."playerId";
  IF unnamed THEN
    RAISE EXCEPTION 'Consent cannot be recorded for a placeholder or opposition player'
      USING ERRCODE = 'check_violation';
  END IF;
  -- The UPDATE takes the player row lock, so the date of birth it returns is
  -- the one any concurrent edit commits before or after, never between.
  UPDATE "Player" SET "consentState" = NEW."state"
   WHERE "organisationId" = NEW."organisationId" AND "id" = NEW."playerId"
  RETURNING "dateOfBirth" INTO dob;
  SELECT max("createdAt") INTO latest
    FROM "Consent"
   WHERE "organisationId" = NEW."organisationId" AND "playerId" = NEW."playerId";
  stamp := (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  IF latest IS NOT NULL AND stamp <= latest THEN
    stamp := latest + interval '1 millisecond';
  END IF;
  NEW."createdAt" := stamp;

  -- Timestamps are stored in UTC without a time zone (Prisma).
  -- Never later than the insert itself: a future grantedAt must not age a
  -- minor into an adult.
  decided := ((LEAST(COALESCE(NEW."grantedAt", NEW."withdrawnAt", stamp), stamp) AT TIME ZONE 'UTC')
              AT TIME ZONE 'Africa/Johannesburg')::date;
  IF dob IS NULL THEN
    minor := true;
  ELSE
    age := extract(year FROM decided)::integer - extract(year FROM dob)::integer;
    IF (extract(month FROM decided), extract(day FROM decided))
       < (extract(month FROM dob), extract(day FROM dob)) THEN
      age := age - 1;
    END IF;
    minor := age < 18;
  END IF;
  NEW."playerWasMinor" := minor;

  -- CONS02: a player under 18 on the decision date needs a parent or guardian.
  IF minor AND NEW."state" IN ('club_only', 'scout_visible') AND NEW."relationship" = 'self' THEN
    RAISE EXCEPTION 'Consent for a player under 18 needs a parent or guardian, not the player'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
