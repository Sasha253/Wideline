import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { ReviewerContext } from "../auth/reviewer";
import { rawDb } from "../db/raw";
import { lockMatchForUpdate } from "../db/locks";
import { refuseImpersonation, ReviewError } from "./errors";
import type { ClaimScope } from "./scope";

/**
 * The one way into a review write (C11; NFR16, REVIEW11, Q-064). claimScope()
 * proved the claim on this request, but a write must hold it until commit: a
 * release, an expiry or a submit in another tab could end it in between. So
 * every write runs in a transaction that first locks the claim row FOR UPDATE
 * and checks it again (the caller's own, active, not past its end), and
 * refuses a "Log in as" session before anything. Ending a claim (endClaim in
 * ./lifecycle.ts) takes the match lock and then the claim row, so a write
 * that needs the match too (submit) takes the match first, in the same order.
 * Every query inside filters by claim.organisationId and claim.matchId by
 * hand: the transaction client is the raw one (src/server/review/ is on the
 * ESLint allowlist), and ClaimDb stays read-only.
 */

export type Tx = Prisma.TransactionClient;
export type LiveClaim = ClaimScope["claim"];

export async function withLiveClaim<T>(
  ctx: ReviewerContext,
  scope: ClaimScope,
  fn: (tx: Tx, claim: LiveClaim) => Promise<T>,
  { now = new Date(), lockMatch = false }: { now?: Date; lockMatch?: boolean } = {},
): Promise<T> {
  refuseImpersonation(ctx);
  const { claim } = scope;
  return rawDb.$transaction(
    async (tx) => {
      if (lockMatch) await lockMatchForUpdate(tx, claim.organisationId, claim.matchId);
      const live = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "ReviewClaim"
         WHERE "id" = ${claim.id}
           AND "organisationId" = ${claim.organisationId}
           AND "matchId" = ${claim.matchId}
           AND "scoutUserId" = ${ctx.user.id}
           AND "status" = 'active'
           AND "expiresAt" > ${now}
           FOR UPDATE`;
      if (live.length !== 1) throw new ReviewError("claim_ended");
      return fn(tx, claim);
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

/** The claimed match's teams, for side checks. */
export async function matchTeams(tx: Tx, claim: LiveClaim) {
  const m = await tx.match.findFirstOrThrow({
    where: { id: claim.matchId, organisationId: claim.organisationId },
    select: { homeTeamId: true, awayTeamId: true },
  });
  return { home: m.homeTeamId, away: m.awayTeamId };
}
