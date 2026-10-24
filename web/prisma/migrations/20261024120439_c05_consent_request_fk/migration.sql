-- C05: Consent.requestId points at a guardian link of the same organisation
-- (NFR16). Before this, requestId was a plain column, so a row could name a
-- link of another organisation, or one that never existed.
--
-- A composite foreign key, like every other reference between tenant tables.
-- NO ACTION on delete and update: a link is never deleted on its own, only by
-- the organisation or player cascade that deletes its Consent rows in the same
-- statement, and its id never changes. The Consent append-only trigger is
-- untouched: this key never updates a Consent row.
--
-- Consent rows are append-only, so a row written before this key with a
-- requestId that matches no link of its organisation cannot be corrected. The
-- key is added NOT VALID, which checks every new row, and then validated only
-- when no such row exists (a fresh database always validates).

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_organisationId_requestId_fkey" FOREIGN KEY ("organisationId", "requestId") REFERENCES "ConsentRequest"("organisationId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM "Consent" c
     WHERE c."requestId" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM "ConsentRequest" r
          WHERE r."organisationId" = c."organisationId" AND r."id" = c."requestId"
       )
  ) THEN
    ALTER TABLE "Consent" VALIDATE CONSTRAINT "Consent_organisationId_requestId_fkey";
  END IF;
END;
$$;
