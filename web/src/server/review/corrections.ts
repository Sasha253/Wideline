import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { EventCorrectionKind } from "@/generated/prisma/enums";
import type { ClaimScope } from "./scope";

/**
 * Review decisions as training data (C11; REVIEW09, Q-067). Every decision
 * the workspace makes writes one EventCorrection per event it changed, in the
 * same transaction as the change: plain confirmations too (kind confirmed),
 * which do not count as corrections. The snapshots hold the event's own
 * fields and never a player id; player ids go in the plain columns, so a
 * consent withdrawal or an erasure can null them with one updateMany (NFR08).
 */

type Tx = Prisma.TransactionClient;
type Claim = ClaimScope["claim"];

/** The event fields a correction records, before and after. No player id. */
export type EventSnapshot = {
  type: string;
  status: string;
  teamSide: string | null;
  trackId: string | null;
  onTarget: boolean | null;
  timestampMs: number;
};

/** The columns eventSnapshot() reads, for a select. */
export const SNAPSHOT_SELECT = {
  type: true,
  status: true,
  teamSide: true,
  trackId: true,
  onTarget: true,
  timestampMs: true,
} as const;

export function eventSnapshot(event: EventSnapshot): EventSnapshot {
  return {
    type: event.type,
    status: event.status,
    teamSide: event.teamSide,
    trackId: event.trackId,
    onTarget: event.onTarget,
    timestampMs: event.timestampMs,
  };
}

export type CorrectionInput = {
  eventId: string;
  kind: EventCorrectionKind;
  /** The snapshot before the change; an empty object for an added event. */
  previous: EventSnapshot | Record<string, never>;
  next: EventSnapshot;
  previousPlayerId: string | null;
  newPlayerId: string | null;
};

/** One correction row, in the caller's claim-checked transaction. */
export async function recordCorrection(
  tx: Tx,
  claim: Claim,
  userId: string,
  input: CorrectionInput,
): Promise<void> {
  await recordCorrections(tx, claim, userId, [input]);
}

/** Many correction rows at once (a relink or a swap moves every event of a track). */
export async function recordCorrections(
  tx: Tx,
  claim: Claim,
  userId: string,
  inputs: CorrectionInput[],
): Promise<void> {
  if (inputs.length === 0) return;
  await tx.eventCorrection.createMany({
    data: inputs.map((c) => ({
      organisationId: claim.organisationId,
      matchId: claim.matchId,
      claimId: claim.id,
      eventId: c.eventId,
      correctedByUserId: userId,
      kind: c.kind,
      previousValue: c.previous,
      newValue: c.next,
      previousPlayerId: c.previousPlayerId,
      newPlayerId: c.newPlayerId,
    })),
  });
}

export type ClaimCounts = {
  /** Distinct events with any decision under this claim. */
  eventsReviewed: number;
  /** Decision rows that changed something: every kind but confirmed (Q-067). */
  corrections: number;
  /** Missed events the scout added. */
  added: number;
};

/** The ReviewClaim counts from a claim's correction rows. Pure, for the unit test. */
export function countsFrom(rows: readonly { eventId: string; kind: EventCorrectionKind }[]) {
  return {
    eventsReviewed: new Set(rows.map((r) => r.eventId)).size,
    corrections: rows.filter((r) => r.kind !== "confirmed").length,
    added: rows.filter((r) => r.kind === "added").length,
  } satisfies ClaimCounts;
}

/** A claim's counts, read on the caller's client (a transaction, or the raw client). */
export async function claimCounts(
  db: Pick<Tx, "eventCorrection">,
  claim: Pick<Claim, "id" | "organisationId">,
): Promise<ClaimCounts> {
  const rows = await db.eventCorrection.findMany({
    where: { organisationId: claim.organisationId, claimId: claim.id },
    select: { eventId: true, kind: true },
  });
  return countsFrom(rows);
}
