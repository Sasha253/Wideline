import "server-only";
import type { EventStatus } from "@/generated/prisma/enums";
import type { ReviewEventType, ReviewSide, WorkspacePatch } from "@/lib/review-workspace";
import type { ReviewerContext } from "../auth/reviewer";
import {
  eventSnapshot,
  recordCorrections,
  SNAPSHOT_SELECT,
  type CorrectionInput,
} from "./corrections";
import { ReviewError } from "./errors";
import { buildPatch, CHANGE_SELECT } from "./patch";
import { eventTargetFor, lineupPick, mayAttributeNow } from "./players";
import type { ClaimScope } from "./scope";
import { withLiveClaim, type LiveClaim, type Tx } from "./writes";

/**
 * Event decisions in the review workspace (C11; REVIEW03, REVIEW04, REVIEW09).
 * Confirm and reject set the status; correct changes the type, the side and
 * the player, and confirms the event. A handled event may be decided again
 * (the scout can change their mind), and each change writes its
 * EventCorrection in the same transaction. A decision that changes nothing
 * writes nothing. Every write goes through withLiveClaim(), so an ended claim
 * or a "Log in as" session changes nothing (claim_ended,
 * impersonation_refused).
 */

const EVENT_SELECT = {
  ...SNAPSHOT_SELECT,
  ...CHANGE_SELECT,
  jobId: true,
  playerSource: true,
} as const;

type Opts = { now?: Date };

async function claimEvent(tx: Tx, claim: LiveClaim, eventId: string) {
  const event = await tx.event.findFirst({
    where: { id: eventId, organisationId: claim.organisationId, matchId: claim.matchId },
    select: EVENT_SELECT,
  });
  if (!event) throw new ReviewError("not_found");
  return event;
}

type ClaimEvent = Awaited<ReturnType<typeof claimEvent>>;

/** Confirmed, or manual again for an event the reviewer added (no CV job). */
const confirmedStatus = (e: Pick<ClaimEvent, "jobId">): EventStatus =>
  e.jobId === null ? "manual" : "confirmed";

async function decide(
  ctx: ReviewerContext,
  scope: ClaimScope,
  eventId: string,
  decision: "confirm" | "reject",
  { now }: Opts,
): Promise<WorkspacePatch> {
  return withLiveClaim(
    ctx,
    scope,
    async (tx, claim) => {
      const before = await claimEvent(tx, claim, eventId);
      const status = decision === "confirm" ? confirmedStatus(before) : "rejected";
      if (before.status === status) return buildPatch(tx, claim, { events: [before] });
      const after = await tx.event.update({
        where: { organisationId_id: { organisationId: claim.organisationId, id: before.id } },
        data: { status },
        select: EVENT_SELECT,
      });
      await recordCorrections(tx, claim, ctx.user.id, [
        {
          eventId: before.id,
          kind: decision === "confirm" ? "confirmed" : "rejected",
          previous: eventSnapshot(before),
          next: eventSnapshot(after),
          previousPlayerId: before.playerId,
          newPlayerId: after.playerId,
        },
      ]);
      return buildPatch(tx, claim, { events: [after] });
    },
    { now },
  );
}

export function confirmEvent(
  ctx: ReviewerContext,
  scope: ClaimScope,
  eventId: string,
  opts: Opts = {},
): Promise<WorkspacePatch> {
  return decide(ctx, scope, eventId, "confirm", opts);
}

export function rejectEvent(
  ctx: ReviewerContext,
  scope: ClaimScope,
  eventId: string,
  opts: Opts = {},
): Promise<WorkspacePatch> {
  return decide(ctx, scope, eventId, "reject", opts);
}

export type CorrectInput = {
  eventId: string;
  type: ReviewEventType;
  /** Shots only; ignored for other types. */
  onTarget: boolean | null;
  side: ReviewSide;
  /** The lineup entry to give the event to, or null for the team only. */
  entryId: string | null;
};

/**
 * Where the event's player goes, inside the transaction. Throws
 * not_in_lineup, or not_attributable (Q-065): the event then stays as it was.
 */
async function playerFields(
  tx: Tx,
  claim: LiveClaim,
  event: ClaimEvent,
  entryId: string | null,
  side: ReviewSide,
) {
  if (entryId === null) {
    // Team only: off the track, which names a player only while linked.
    if (event.playerId === null) return null;
    return { trackId: null, playerId: null, playerSource: null };
  }
  const pick = await lineupPick(tx, claim, entryId, side);
  if (pick.playerId === event.playerId) return null;
  if (!(await mayAttributeNow(tx, claim.organisationId, pick.playerId))) {
    throw new ReviewError("not_attributable");
  }
  const target = await eventTargetFor(tx, claim, pick.playerId);
  return { ...target, playerId: pick.playerId };
}

/**
 * Edit event (Surface 2): the type, on target, the side and the player in
 * one transaction, so nothing shows as saved unless all of it is. A changed
 * player writes a reassigned correction; the other fields an edited one. A
 * side change takes the event off a track of the other side, and off a
 * player of the other team. Saving confirms the event.
 */
export async function correctEvent(
  ctx: ReviewerContext,
  scope: ClaimScope,
  input: CorrectInput,
  { now }: Opts = {},
): Promise<WorkspacePatch> {
  return withLiveClaim(
    ctx,
    scope,
    async (tx, claim) => {
      const before = await claimEvent(tx, claim, input.eventId);
      const onTarget = input.type === "shot" ? input.onTarget : null;
      const corrections: CorrectionInput[] = [];

      // 1. The player (REVIEW04), so a refusal changes nothing.
      let player = await playerFields(tx, claim, before, input.entryId, input.side);
      if (!player && input.entryId === null && before.trackId && input.side !== before.teamSide) {
        // An unlinked track of the other side: the event leaves it.
        const track = await tx.track.findFirst({
          where: { id: before.trackId, organisationId: claim.organisationId },
          select: { teamSide: true },
        });
        if (track && track.teamSide !== input.side) {
          player = { trackId: null, playerId: null, playerSource: null };
        }
      }
      let current = before;
      if (player) {
        current = await tx.event.update({
          where: { organisationId_id: { organisationId: claim.organisationId, id: before.id } },
          data: { ...player, teamSide: input.side, status: confirmedStatus(before) },
          select: EVENT_SELECT,
        });
        corrections.push({
          eventId: before.id,
          kind: "reassigned",
          previous: eventSnapshot(before),
          next: eventSnapshot(current),
          previousPlayerId: before.playerId,
          newPlayerId: current.playerId,
        });
      }

      // 2. The event's own fields.
      const fieldsChanged =
        current.type !== input.type ||
        current.onTarget !== onTarget ||
        current.teamSide !== input.side;
      if (fieldsChanged) {
        const prior = current;
        current = await tx.event.update({
          where: { organisationId_id: { organisationId: claim.organisationId, id: before.id } },
          data: {
            type: input.type,
            onTarget,
            teamSide: input.side,
            status: confirmedStatus(before),
          },
          select: EVENT_SELECT,
        });
        corrections.push({
          eventId: before.id,
          kind: "edited",
          previous: eventSnapshot(prior),
          next: eventSnapshot(current),
          previousPlayerId: prior.playerId,
          newPlayerId: current.playerId,
        });
      } else if (!player && current.status !== confirmedStatus(before)) {
        // Nothing to correct: saving confirms it.
        current = await tx.event.update({
          where: { organisationId_id: { organisationId: claim.organisationId, id: before.id } },
          data: { status: confirmedStatus(before) },
          select: EVENT_SELECT,
        });
        corrections.push({
          eventId: before.id,
          kind: "confirmed",
          previous: eventSnapshot(before),
          next: eventSnapshot(current),
          previousPlayerId: before.playerId,
          newPlayerId: current.playerId,
        });
      }
      await recordCorrections(tx, claim, ctx.user.id, corrections);
      const corrected = corrections.some((c) => c.kind !== "confirmed") ? [before.id] : [];
      return buildPatch(tx, claim, { events: [current], corrected });
    },
    { now },
  );
}

/** Reassign an event (REVIEW04) and nothing else: correctEvent with its own type and side. */
export async function reassignEvent(
  ctx: ReviewerContext,
  scope: ClaimScope,
  { eventId, entryId }: { eventId: string; entryId: string | null },
  opts: Opts = {},
): Promise<WorkspacePatch> {
  const event = await scope.db.event.findFirst({
    where: { id: eventId },
    select: { type: true, onTarget: true, teamSide: true },
  });
  if (!event) throw new ReviewError("not_found");
  let side = event.teamSide === "home" || event.teamSide === "away" ? event.teamSide : null;
  if (!side) {
    // A side not set takes the player's side.
    const entry = entryId
      ? await scope.db.lineup.findFirst({ where: { id: entryId }, select: { teamId: true } })
      : null;
    const match = await scope.db.match.findFirst({ select: { homeTeamId: true } });
    if (!entry || !match) throw new ReviewError("not_in_lineup");
    side = entry.teamId === match.homeTeamId ? "home" : "away";
  }
  return correctEvent(
    ctx,
    scope,
    { eventId, type: event.type, onTarget: event.onTarget, side, entryId },
    opts,
  );
}
