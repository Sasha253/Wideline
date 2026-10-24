-- C05: the database decides whether the player was a minor (CONS02, NFR08).
--
-- "Consent"."playerWasMinor" used to be whatever the caller wrote, and the
-- Consent_minor_needs_guardian CHECK trusted it, so a buggy or hostile caller
-- could store a 14-year-old's own 'self' grant with playerWasMinor = false.
--
-- Before each insert the trigger now derives it from "Player"."dateOfBirth",
-- read under the player row lock it already takes, on the decision date:
-- grantedAt, or withdrawnAt for a withdrawal, or the insert time for a row with
-- neither (a request). The date is the calendar day in Africa/Johannesburg, and
-- the age is counted in whole years as isMinorOn() does
-- (src/lib/consent-rules.ts), so a birthday on 29 February turns 18 on 1 March
-- in a common year. No date of birth counts as a minor. The derived value
-- overrides the caller's. A grant with relationship 'self' for a minor is then
-- refused here, and by the CHECK, which PostgreSQL evaluates after BEFORE
-- triggers and so also sees the derived value.
--
-- Everything else is as in c05_consent_order: placeholder and opposition
-- players are refused, the Player cache is written (taking the row lock), and
-- createdAt is stamped strictly after the player's newest row. The append-only
-- trigger is unchanged.
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
  decided := ((COALESCE(NEW."grantedAt", NEW."withdrawnAt", stamp) AT TIME ZONE 'UTC')
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
