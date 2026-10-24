-- C05: a strict order for consent rows of one player.
--
-- "Consent"."createdAt" is TIMESTAMP(3), so two rows written within one
-- millisecond (two inserts in one transaction, or a quick double submit) would
-- tie, and "the newest row" would be ambiguous. Under the player row lock the
-- trigger now stamps the later of clock_timestamp() and the player's newest
-- row plus 1 ms, in UTC like Prisma's own timestamps. Rows of one player are
-- therefore strictly ordered, in the order the lock serialised them, and the
-- newest one always matches Player.consentState.
CREATE OR REPLACE FUNCTION "Consent_before_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  unnamed boolean;
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
  UPDATE "Player" SET "consentState" = NEW."state"
   WHERE "organisationId" = NEW."organisationId" AND "id" = NEW."playerId";
  SELECT max("createdAt") INTO latest
    FROM "Consent"
   WHERE "organisationId" = NEW."organisationId" AND "playerId" = NEW."playerId";
  stamp := (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  IF latest IS NOT NULL AND stamp <= latest THEN
    stamp := latest + interval '1 millisecond';
  END IF;
  NEW."createdAt" := stamp;
  RETURN NEW;
END;
$$;
