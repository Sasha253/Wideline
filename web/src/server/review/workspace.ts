import "server-only";
import { autoAcceptThresholds } from "@/lib/auto-accept";
import type { Markers } from "@/lib/match-clock";
import { queueSection, type QueueSection } from "@/lib/review-rules";
import {
  sidesConfirmed,
  type ReviewSide,
  type WorkspaceEntry,
  type WorkspaceEvent,
  type WorkspaceFacts,
  type WorkspaceTrack,
} from "@/lib/review-workspace";
import { attributablePlayerIds, consentVisibleTo } from "../consent/visibility";
import { rawDb } from "../db/raw";
import { claimCounts } from "./corrections";
import { sideOf } from "./patch";
import type { ClaimScope } from "./scope";
import { sideEvidence } from "./tracks";

/**
 * The review workspace's data (C11; REVIEW03, REVIEW06, Q-021). Every read
 * goes through the claim's own client (scope.db), so it reaches only the
 * claimed match, and players by name only when the reviewer may see them.
 * Players reach the client as lineup entries with a label built here:
 * "#7 Thabo Nkosi" for a scout_visible player, "Home #7" for anyone else. No
 * player id, other name or consent state leaves this module.
 */

export type WorkspaceData = {
  /** Team names come from the page (Team is not a review model on ClaimDb). */
  match: { id: string; halfLengthMinutes: number };
  video: {
    durationMs: number | null;
    hls: boolean;
    section: QueueSection;
    markers: Markers;
  };
  entries: WorkspaceEntry[];
  tracks: WorkspaceTrack[];
  events: WorkspaceEvent[];
};

const SIDE_WORD: Record<ReviewSide, string> = { home: "Home", away: "Away" };

/** "Thabo Nkosi", or null for a player with no name. */
const fullName = (p: { firstName: string | null; lastName: string | null }) =>
  [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || null;

export async function loadWorkspace(
  scope: ClaimScope,
  { now = new Date() }: { now?: Date } = {},
): Promise<WorkspaceData> {
  const { db, claim } = scope;
  const match = await db.match.findFirstOrThrow({
    select: { id: true, homeTeamId: true, awayTeamId: true, halfLengthMinutes: true },
  });
  const [video, lineup, tracks, events, clips] = await Promise.all([
    db.video.findFirstOrThrow({
      where: { id: claim.videoId },
      select: {
        durationSec: true,
        hlsManifestPath: true,
        rawExpiresAt: true,
        deletedAt: true,
        kickoffMs: true,
        halfTimeMs: true,
        secondHalfKickoffMs: true,
        fullTimeMs: true,
      },
    }),
    db.lineup.findMany({
      select: { id: true, teamId: true, playerId: true, shirtNumber: true },
      orderBy: [{ shirtNumber: "asc" }],
    }),
    db.track.findMany({
      select: { id: true, trackIndex: true, teamSide: true, playerId: true },
      orderBy: [{ trackIndex: "asc" }],
    }),
    db.event.findMany({
      select: {
        id: true,
        timestampMs: true,
        type: true,
        onTarget: true,
        status: true,
        teamSide: true,
        trackId: true,
        playerId: true,
        confidence: true,
        clipStartMs: true,
        clipEndMs: true,
        jobId: true,
      },
      orderBy: [{ timestampMs: "asc" }, { id: "asc" }],
    }),
    db.clip.findMany({ where: { deletedAt: null }, select: { id: true, eventId: true } }),
  ]);
  const named = await db.player.findMany({
    where: {
      ...consentVisibleTo({ kind: "reviewer" }),
      id: { in: lineup.map((l) => l.playerId) },
    },
    select: { id: true, firstName: true, lastName: true },
  });
  const names = new Map(named.flatMap((p) => (fullName(p) ? [[p.id, fullName(p)!]] : [])));
  const sideOfTeam = (teamId: string): ReviewSide | null =>
    teamId === match.homeTeamId ? "home" : teamId === match.awayTeamId ? "away" : null;

  const entries = lineup.flatMap((l): WorkspaceEntry[] => {
    const side = sideOfTeam(l.teamId);
    if (!side) return [];
    const name = names.get(l.playerId);
    return [
      {
        id: l.id,
        side,
        shirtNumber: l.shirtNumber,
        label: name ? `#${l.shirtNumber} ${name}` : `${SIDE_WORD[side]} #${l.shirtNumber}`,
      },
    ];
  });
  // CONS03/NFR11: re-check consent on this live read, as the clip route does,
  // so a withdrawn player's events and track read team-level (entryId null)
  // at once, not only after the consent-withdrawn purge has run.
  const attributed = [
    ...new Set(
      [...events.map((e) => e.playerId), ...tracks.map((t) => t.playerId)].filter(
        (id): id is string => id !== null,
      ),
    ),
  ];
  const allowed = await attributablePlayerIds(rawDb, claim.organisationId, attributed);
  const entryOf = new Map(
    lineup.filter((l) => allowed.has(l.playerId)).map((l) => [l.playerId, l.id]),
  );
  const entry = (playerId: string | null) => (playerId ? (entryOf.get(playerId) ?? null) : null);
  const clipOf = new Map(clips.map((c) => [c.eventId, c.id]));
  const corrected = await correctedEventIds(scope);

  return {
    match: { id: match.id, halfLengthMinutes: match.halfLengthMinutes },
    video: {
      durationMs: video.durationSec === null ? null : Math.round(video.durationSec * 1000),
      hls: video.hlsManifestPath !== null,
      section: queueSection(video, now),
      markers: {
        kickoffMs: video.kickoffMs,
        halfTimeMs: video.halfTimeMs,
        secondHalfKickoffMs: video.secondHalfKickoffMs,
        fullTimeMs: video.fullTimeMs,
      },
    },
    entries,
    tracks: tracks.map((t) => ({
      id: t.id,
      index: t.trackIndex,
      side: sideOf(t.teamSide),
      entryId: entry(t.playerId),
    })),
    events: events.map((e) => ({
      id: e.id,
      timestampMs: e.timestampMs,
      type: e.type,
      onTarget: e.onTarget,
      status: e.status,
      side: sideOf(e.teamSide),
      trackId: e.trackId,
      entryId: entry(e.playerId),
      confidence: e.confidence,
      clipId: clipOf.get(e.id) ?? null,
      clipStartMs: e.clipStartMs,
      clipEndMs: e.clipEndMs,
      corrected: corrected.has(e.id),
      manual: e.jobId === null,
      toCheck: e.jobId !== null && e.status !== "auto_accepted",
    })),
  };
}

/**
 * Events edited or reassigned in any review of this match: ids only. Read on
 * the raw client with the claim's own ids (EventCorrection is not a review
 * model on ClaimDb), like claimFacts().
 */
async function correctedEventIds({ claim }: ClaimScope): Promise<Set<string>> {
  const rows = await rawDb.eventCorrection.findMany({
    where: {
      organisationId: claim.organisationId,
      matchId: claim.matchId,
      kind: { in: ["edited", "reassigned"] },
    },
    select: { eventId: true },
    distinct: ["eventId"],
  });
  return new Set(rows.map((r) => r.eventId));
}

/**
 * The claim's facts that are not match rows (C11): the organisation's
 * auto-accept thresholds, whether the sides are unconfirmed (Q-041, from the
 * CV job's shirt-number counts), the reviewer's own favourites among the
 * match's clips, and the claim's counts. The one documented exception to
 * "reads go through ClaimDb": it uses the raw client, but only with the
 * claim's own ids, and returns no player data, so ClaimDb is never widened.
 */
export async function claimFacts(scope: ClaimScope, userId: string): Promise<WorkspaceFacts> {
  const { claim } = scope;
  const [org, evidence, favourites, counts] = await Promise.all([
    rawDb.organisation.findUniqueOrThrow({
      where: { id: claim.organisationId },
      select: { settings: true },
    }),
    sideEvidence(rawDb, claim),
    rawDb.clipFavourite.findMany({
      where: {
        organisationId: claim.organisationId,
        userId,
        clip: { matchId: claim.matchId, organisationId: claim.organisationId },
      },
      select: { clipId: true },
    }),
    claimCounts(rawDb, claim),
  ]);
  return {
    thresholds: autoAcceptThresholds(org.settings),
    sidesUnconfirmed: !sidesConfirmed(evidence),
    favouritedClipIds: favourites.map((f) => f.clipId),
    counts,
  };
}
