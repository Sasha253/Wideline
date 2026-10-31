-- C10: database rules for review claims that Prisma cannot declare. The app
-- checks each one first, for the message; these make sure no path (a script, a
-- race, a cascade) can store a broken claim.

-- REVIEW01: a claim lasts a window of time.
ALTER TABLE "ReviewClaim" ADD CONSTRAINT "ReviewClaim_window"
  CHECK ("expiresAt" > "claimedAt");

-- An active claim has not ended; every other status has.
ALTER TABLE "ReviewClaim" ADD CONSTRAINT "ReviewClaim_ended_consistent"
  CHECK ((status = 'active') = ("endedAt" IS NULL));

-- A submitted claim (C11) records when.
ALTER TABLE "ReviewClaim" ADD CONSTRAINT "ReviewClaim_submitted_has_time"
  CHECK (status <> 'submitted' OR "submittedAt" IS NOT NULL);

-- Only a released claim has a release reason, and it always has one.
ALTER TABLE "ReviewClaim" ADD CONSTRAINT "ReviewClaim_release_reason"
  CHECK ((status = 'released') = ("releaseReason" IS NOT NULL));

ALTER TABLE "ReviewClaim" ADD CONSTRAINT "ReviewClaim_counts_nonneg"
  CHECK ("eventsReviewed" >= 0 AND "corrections" >= 0);

-- Q-050: one scout holds one claimed match at a time on the pilot plan. A
-- registry key the plan lacks falls back to the registry (1) anyway; this
-- writes it on the plan row so the admin page shows the plan's value.
UPDATE "Plan"
   SET limits = limits || '{"review_claims_active": 1}'::jsonb
 WHERE code = 'pilot' AND NOT limits ? 'review_claims_active';
