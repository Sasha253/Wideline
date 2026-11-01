import "server-only";
import { queueSection } from "@/lib/review-rules";
import type { ReviewEventType, ReviewSide, WorkspacePatch } from "@/lib/review-workspace";
import type { ReviewerContext } from "../auth/reviewer";
import { eventSnapshot, recordCorrection, SNAPSHOT_SELECT } from "./corrections";
import { ReviewError } from "./errors";
import { buildPatch, CHANGE_SELECT, sideOf } from "./patch";
import { eventTargetFor, lineupPick, mayAttributeNow } from "./players";
import type { ClaimScope } from "./scope";
import { withLiveClaim } from "./writes";

/**
 * Add a missed event (C11; REVIEW05, REVIEW09). Only while the raw footage
 * exists: the claim's video is re-read in the transaction, so footage that
 * expired or was deleted while the page was open refuses the add
 * (raw_footage_gone). The event is manual (no CV job, no confidence) and
 * keeps a clip window of 5 s either side, clamped to the video, so a clip can
 * be cut later. A player is checked as for a reassignment; one whose events
 * cannot be recorded (Q-065) leaves the event with the team, and the result
 * says so (notAttributable).
 */

export const MISSED_CLIP_HALF_MS = 5000;

export type MissedInput = {
  timestampMs: number;
  type: ReviewEventType;
  onTarget: boolean | null;
  side: ReviewSide;
  entryId: string | null;
};

export type MissedResult = WorkspacePatch & { notAttributable: boolean };

export async function addMissedEvent(
  ctx: ReviewerContext,
  scope: ClaimScope,
  input: MissedInput,
  { now = new Date() }: { now?: Date } = {},
): Promise<MissedResult> {
  return withLiveClaim(
    ctx,
    scope,
    async (tx, claim) => {
      const video = await tx.video.findFirstOrThrow({
        where: { id: claim.videoId, organisationId: claim.organisationId, matchId: claim.matchId },
        select: { rawExpiresAt: true, deletedAt: true, durationSec: true },
      });
      if (video.deletedAt || queueSection(video, now) !== "waiting") {
        throw new ReviewError("raw_footage_gone");
      }
      const durationMs = video.durationSec === null ? null : Math.round(video.durationSec * 1000);
      const t = input.timestampMs;
      if (!Number.isInteger(t) || t < 0 || (durationMs !== null && t > durationMs)) {
        throw new ReviewError("out_of_range");
      }

      let player: {
        playerId: string;
        trackId: string | null;
        playerSource: "track" | "reviewer";
      } | null = null;
      let notAttributable = false;
      if (input.entryId) {
        const pick = await lineupPick(tx, claim, input.entryId, input.side);
        if (await mayAttributeNow(tx, claim.organisationId, pick.playerId)) {
          player = { playerId: pick.playerId, ...(await eventTargetFor(tx, claim, pick.playerId)) };
        } else {
          notAttributable = true;
        }
      }

      const event = await tx.event.create({
        data: {
          organisationId: claim.organisationId,
          matchId: claim.matchId,
          type: input.type,
          status: "manual",
          teamSide: input.side,
          onTarget: input.type === "shot" ? input.onTarget : null,
          timestampMs: t,
          clipStartMs: Math.max(0, t - MISSED_CLIP_HALF_MS),
          clipEndMs:
            durationMs === null
              ? t + MISSED_CLIP_HALF_MS
              : Math.min(durationMs, t + MISSED_CLIP_HALF_MS),
          trackId: player?.trackId ?? null,
          playerId: player?.playerId ?? null,
          playerSource: player ? player.playerSource : null,
        },
        select: { ...SNAPSHOT_SELECT, ...CHANGE_SELECT, clipStartMs: true, clipEndMs: true },
      });
      await recordCorrection(tx, claim, ctx.user.id, {
        eventId: event.id,
        kind: "added",
        previous: {},
        next: eventSnapshot(event),
        previousPlayerId: null,
        newPlayerId: event.playerId,
      });
      const patch = await buildPatch(tx, claim, { events: [event] });
      const change = patch.events[0]!;
      return {
        ...patch,
        events: [],
        added: {
          ...change,
          timestampMs: event.timestampMs,
          side: sideOf(event.teamSide),
          confidence: null,
          clipId: null,
          clipStartMs: event.clipStartMs,
          clipEndMs: event.clipEndMs,
          corrected: false,
          manual: true,
          toCheck: false,
        },
        notAttributable,
      };
    },
    { now },
  );
}
