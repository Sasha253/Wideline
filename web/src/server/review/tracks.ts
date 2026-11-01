import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { TeamSide } from "@/generated/prisma/enums";
import { sidesConfirmed, type WorkspacePatch } from "@/lib/review-workspace";
import type { ReviewerContext } from "../auth/reviewer";
import {
  eventSnapshot,
  recordCorrections,
  SNAPSHOT_SELECT,
  type CorrectionInput,
} from "./corrections";
import { ReviewError } from "./errors";
import { buildPatch, CHANGE_SELECT, TRACK_SELECT } from "./patch";
import { lineupPick, mayAttributeNow } from "./players";
import type { ClaimScope } from "./scope";
import { matchTeams, withLiveClaim, type LiveClaim, type Tx } from "./writes";

/**
 * The track-link editor and the side swap (C11; REVIEW06, REVIEW09, Q-041,
 * Q-065, NFR08).
 *
 * Relinking a track gives every event on it to the new player in one
 * transaction, with one relinked correction per event that moved. Events the
 * reviewer gave to a player on their own are not on a track (playerSource
 * reviewer), so they keep their player. The player is checked as ingest does
 * (attributablePlayerIds under FOR SHARE): a refusal discards the track as
 * ingest would have, so its events keep only their side, with no track,
 * player or position, and the track and its points go.
 *
 * Swapping home and away is for matches whose sides the CV job could not
 * settle from shirt numbers (Q-041). It flips every track and event, and
 * takes away any player link that the new side's team does not hold.
 */

type Opts = { now?: Date };

const EVENT_SELECT = { ...SNAPSHOT_SELECT, ...CHANGE_SELECT, playerSource: true } as const;

const flip = (s: TeamSide | null): TeamSide | null =>
  s === "home" ? "away" : s === "away" ? "home" : s;

export type RelinkResult = WorkspacePatch & {
  /** The track was removed (Q-065): its player's events cannot be recorded. */
  discarded: boolean;
  /** Events that moved, or that went back to the team on a discard. */
  moved: number;
};

export async function relinkTrack(
  ctx: ReviewerContext,
  scope: ClaimScope,
  { trackId, entryId }: { trackId: string; entryId: string | null },
  { now }: Opts = {},
): Promise<RelinkResult> {
  return withLiveClaim(
    ctx,
    scope,
    async (tx, claim) => {
      const where = { organisationId: claim.organisationId, matchId: claim.matchId };
      const track = await tx.track.findFirst({
        where: { ...where, id: trackId },
        select: TRACK_SELECT,
      });
      if (!track) throw new ReviewError("not_found");
      const side = track.teamSide === "home" || track.teamSide === "away" ? track.teamSide : null;
      const pick = entryId ? await lineupPick(tx, claim, entryId, side) : null;
      const playerId = pick?.playerId ?? null;
      if (playerId === track.playerId) {
        return {
          ...(await buildPatch(tx, claim, { tracks: [track] })),
          discarded: false,
          moved: 0,
        };
      }
      const events = await tx.event.findMany({
        where: { ...where, trackId: track.id },
        select: EVENT_SELECT,
      });

      if (pick && !(await mayAttributeNow(tx, claim.organisationId, pick.playerId))) {
        // Q-065: discard, as ingest does.
        await tx.event.updateMany({
          where: { ...where, trackId: track.id },
          data: { trackId: null, playerId: null, playerSource: null, pitchX: null, pitchY: null },
        });
        await tx.track.delete({
          where: { organisationId_id: { organisationId: claim.organisationId, id: track.id } },
        });
        const after = await tx.event.findMany({
          where: { ...where, id: { in: events.map((e) => e.id) } },
          select: EVENT_SELECT,
        });
        await recordCorrections(tx, claim, ctx.user.id, relinked(events, after));
        const patch = await buildPatch(tx, claim, {
          events: after,
          removedTrackIds: [track.id],
        });
        return { ...patch, discarded: true, moved: after.length };
      }

      const newSide = side ?? pick?.side ?? null;
      const updated = await tx.track.update({
        where: { organisationId_id: { organisationId: claim.organisationId, id: track.id } },
        data: {
          playerId,
          // Track_values: linkedBy is set exactly when a player is.
          linkedBy: playerId ? "reviewer" : null,
          linkedByUserId: playerId ? ctx.user.id : null,
          linkConfidence: null,
          ...(newSide && !side && { teamSide: newSide }),
        },
        select: TRACK_SELECT,
      });
      // The track's own events; none is a reviewer's own pick (those have no track).
      const moving = events.filter((e) => e.playerSource !== "reviewer");
      await tx.event.updateMany({
        where: { ...where, trackId: track.id, id: { in: moving.map((e) => e.id) } },
        data: {
          playerId,
          playerSource: playerId ? "track" : null,
          ...(newSide && !side && { teamSide: newSide }),
        },
      });
      const after = await tx.event.findMany({
        where: { ...where, id: { in: moving.map((e) => e.id) } },
        select: EVENT_SELECT,
      });
      const changes = relinked(moving, after);
      await recordCorrections(tx, claim, ctx.user.id, changes);
      const patch = await buildPatch(tx, claim, { events: after, tracks: [updated] });
      return { ...patch, discarded: false, moved: changes.length };
    },
    { now },
  );
}

type EventRow = Prisma.EventGetPayload<{ select: typeof EVENT_SELECT }>;

/** One relinked correction per event whose player or track changed. */
function relinked(before: EventRow[], after: EventRow[]): CorrectionInput[] {
  const byId = new Map(before.map((e) => [e.id, e]));
  return after.flatMap((a) => {
    const b = byId.get(a.id);
    if (!b || (b.playerId === a.playerId && b.trackId === a.trackId)) return [];
    return [
      {
        eventId: a.id,
        kind: "relinked" as const,
        previous: eventSnapshot(b),
        next: eventSnapshot(a),
        previousPlayerId: b.playerId,
        newPlayerId: a.playerId,
      },
    ];
  });
}

/** The CV job's Q-041 shirt-number evidence for the claimed video, or null. Counts only. */
export async function sideEvidence(
  db: Pick<Tx, "processingJob">,
  claim: Pick<LiveClaim, "organisationId" | "matchId" | "videoId">,
): Promise<{ kept: number; swapped: number } | null> {
  const job = await db.processingJob.findFirst({
    where: {
      organisationId: claim.organisationId,
      matchId: claim.matchId,
      videoId: claim.videoId,
      type: "cv",
      status: "succeeded",
    },
    select: { metadata: true },
  });
  const ev = (job?.metadata as { teamSideEvidence?: unknown } | null)?.teamSideEvidence as
    { kept?: unknown; swapped?: unknown } | undefined;
  if (!ev || typeof ev.kept !== "number" || typeof ev.swapped !== "number") return null;
  return { kept: ev.kept, swapped: ev.swapped };
}

export type SwapResult = WorkspacePatch & { unlinked: number };

/**
 * Swap home and away (Q-041). Refused with sides_confirmed when the CV job's
 * evidence settled the sides. Writes a sides_swapped correction per event.
 */
export async function swapTeamSides(
  ctx: ReviewerContext,
  scope: ClaimScope,
  { now }: Opts = {},
): Promise<SwapResult> {
  return withLiveClaim(
    ctx,
    scope,
    async (tx, claim) => {
      if (sidesConfirmed(await sideEvidence(tx, claim))) throw new ReviewError("sides_confirmed");
      const where = { organisationId: claim.organisationId, matchId: claim.matchId };
      const teams = await matchTeams(tx, claim);
      const lineup = await tx.lineup.findMany({
        where,
        select: { playerId: true, teamId: true },
      });
      const teamOf = new Map(lineup.map((l) => [l.playerId, l.teamId]));
      const holds = (side: TeamSide | null, playerId: string | null) =>
        !playerId || ((side === "home" || side === "away") && teamOf.get(playerId) === teams[side]);

      const tracks = await tx.track.findMany({ where, select: TRACK_SELECT });
      const unlink = new Set(
        tracks.filter((t) => !holds(flip(t.teamSide), t.playerId)).map((t) => t.id),
      );
      const events = await tx.event.findMany({ where, select: EVENT_SELECT });

      for (const t of tracks) {
        await tx.track.update({
          where: { organisationId_id: { organisationId: claim.organisationId, id: t.id } },
          data: {
            teamSide: flip(t.teamSide)!,
            ...(unlink.has(t.id) && {
              playerId: null,
              linkedBy: null,
              linkedByUserId: null,
              linkConfidence: null,
            }),
          },
        });
      }
      const changes: CorrectionInput[] = [];
      for (const e of events) {
        const side = flip(e.teamSide);
        const losesPlayer =
          (e.trackId !== null && unlink.has(e.trackId)) ||
          (e.playerSource === "reviewer" && !holds(side, e.playerId));
        const data = {
          teamSide: side,
          ...(losesPlayer && { playerId: null, playerSource: null }),
        };
        if (side === e.teamSide && !losesPlayer) continue;
        const after = await tx.event.update({
          where: { organisationId_id: { organisationId: claim.organisationId, id: e.id } },
          data,
          select: EVENT_SELECT,
        });
        changes.push({
          eventId: e.id,
          kind: "sides_swapped",
          previous: eventSnapshot(e),
          next: eventSnapshot(after),
          previousPlayerId: e.playerId,
          newPlayerId: after.playerId,
        });
      }
      await recordCorrections(tx, claim, ctx.user.id, changes);
      const patch = await buildPatch(tx, claim, {
        events: await tx.event.findMany({ where, select: EVENT_SELECT }),
        tracks: await tx.track.findMany({ where, select: TRACK_SELECT }),
      });
      return { ...patch, unlinked: unlink.size };
    },
    { now },
  );
}
