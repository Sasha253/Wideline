-- CreateEnum
CREATE TYPE "ConsentMethod" AS ENUM ('paper_form', 'in_person', 'guardian_link', 'email');

-- CreateEnum
CREATE TYPE "ConsentRelationship" AS ENUM ('self', 'parent', 'legal_guardian', 'grandparent', 'other_relative');

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "state" "ConsentState" NOT NULL,
    "clubStats" BOOLEAN NOT NULL,
    "scoutVisible" BOOLEAN NOT NULL,
    "grantedBy" TEXT,
    "relationship" "ConsentRelationship",
    "method" "ConsentMethod",
    "wordingVersion" TEXT,
    "playerWasMinor" BOOLEAN NOT NULL,
    "grantedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "recordedById" TEXT,
    "requestId" TEXT,
    "evidencePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRequest" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ConsentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Consent_organisationId_playerId_createdAt_idx" ON "Consent"("organisationId", "playerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Consent_organisationId_id_key" ON "Consent"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentRequest_tokenHash_key" ON "ConsentRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "ConsentRequest_organisationId_playerId_idx" ON "ConsentRequest"("organisationId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentRequest_organisationId_id_key" ON "ConsentRequest"("organisationId", "id");

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_organisationId_playerId_fkey" FOREIGN KEY ("organisationId", "playerId") REFERENCES "Player"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRequest" ADD CONSTRAINT "ConsentRequest_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRequest" ADD CONSTRAINT "ConsentRequest_organisationId_playerId_fkey" FOREIGN KEY ("organisationId", "playerId") REFERENCES "Player"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRequest" ADD CONSTRAINT "ConsentRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- C05: consent rules the database enforces (docs/build/design/C05.md; PRD
-- "Rules the schema must enforce"). Prisma cannot declare these; schema.prisma
-- lists them on the Consent model.
-- ---------------------------------------------------------------------------

-- NFR10: the state follows from the two choices.
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_state_matches_choices" CHECK (
  ("state" = 'scout_visible' AND "clubStats" AND "scoutVisible")
  OR ("state" = 'club_only' AND "clubStats" AND NOT "scoutVisible")
  OR ("state" IN ('none', 'requested', 'withdrawn') AND NOT "clubStats" AND NOT "scoutVisible")
);

-- Scouts can only see stats the club records.
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_scout_needs_club"
  CHECK (NOT "scoutVisible" OR "clubStats");

-- NFR09: a grant records who decided, their relationship, the method, the
-- wording version shown and the date.
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_grant_complete" CHECK (
  "state" NOT IN ('club_only', 'scout_visible')
  OR (
    "grantedBy" IS NOT NULL AND length(btrim("grantedBy")) > 0
    AND "relationship" IS NOT NULL
    AND "method" IS NOT NULL
    AND "wordingVersion" IS NOT NULL
    AND "grantedAt" IS NOT NULL
  )
);

-- CONS02: a player under 18 on the decision date needs a parent or guardian.
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_minor_needs_guardian" CHECK (
  NOT "playerWasMinor"
  OR "state" NOT IN ('club_only', 'scout_visible')
  OR "relationship" <> 'self'
);

ALTER TABLE "Consent" ADD CONSTRAINT "Consent_withdrawn_has_time"
  CHECK ("state" <> 'withdrawn' OR "withdrawnAt" IS NOT NULL);

-- Append-only. UPDATE and DELETE raise. The exceptions run inside another
-- trigger (pg_trigger_depth() > 1), which a direct statement never does:
--  - DELETE through a cascade (organisation or player deleted; V104 erasure);
--  - UPDATE of recordedById only, by the foreign key action when a user is
--    deleted (SET NULL). Every other column must stay as it was.
CREATE FUNCTION "Consent_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Consent is append-only: rows cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF pg_trigger_depth() > 1
     AND (to_jsonb(NEW) - 'recordedById') = (to_jsonb(OLD) - 'recordedById') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Consent is append-only: rows cannot be updated'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "Consent_append_only"
  BEFORE UPDATE OR DELETE ON "Consent"
  FOR EACH ROW EXECUTE FUNCTION "Consent_append_only"();

-- CONS01: the newest row is the current state. Before each insert: refuse a
-- placeholder or opposition player, write the state into the Player cache
-- (the UPDATE locks the player row, so concurrent changes to one player run one
-- after the other), then stamp createdAt with clock_timestamp(), taken after
-- the lock, so the newest row by createdAt always matches the cache. A
-- playerId of another organisation matches no row here and fails the
-- composite foreign key after this trigger.
CREATE FUNCTION "Consent_before_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  unnamed boolean;
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
  NEW."createdAt" := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Consent_before_insert"
  BEFORE INSERT ON "Consent"
  FOR EACH ROW EXECUTE FUNCTION "Consent_before_insert"();

-- Player.consentState is a cache only the Consent trigger writes. A new player
-- starts at none; any other change raises unless it comes from inside a
-- trigger (Consent_before_insert).
CREATE FUNCTION "Player_consentState_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."consentState" <> 'none' THEN
      RAISE EXCEPTION 'Player.consentState starts at none; record a Consent row instead'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."consentState" IS DISTINCT FROM OLD."consentState" AND pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'Player.consentState is written only by the Consent trigger; insert a Consent row'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Player_consentState_guard"
  BEFORE INSERT OR UPDATE ON "Player"
  FOR EACH ROW EXECUTE FUNCTION "Player_consentState_guard"();
