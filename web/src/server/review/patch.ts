import "server-only";
import type { TeamSide } from "@/generated/prisma/enums";
import type {
  EventChange,
  ReviewSide,
  WorkspacePatch,
  WorkspaceTrack,
} from "@/lib/review-workspace";
import { claimCounts } from "./corrections";
import { entryIdsByPlayer } from "./players";
import type { LiveClaim, Tx } from "./writes";

/**
 * What a review write sends back (C11): the changed rows in the workspace's
 * own shape (lineup entries, never player ids) and the claim's counts after
 * the write, read in the same transaction, so the client's optimistic state
 * settles on the committed values.
 */

export const sideOf = (s: TeamSide | null): ReviewSide | null =>
  s === "home" || s === "away" ? s : null;

/** The event columns a patch needs. */
export const CHANGE_SELECT = {
  id: true,
  type: true,
  onTarget: true,
  status: true,
  teamSide: true,
  trackId: true,
  playerId: true,
} as const;

type ChangeRow = {
  id: string;
  type: EventChange["type"];
  onTarget: boolean | null;
  status: EventChange["status"];
  teamSide: TeamSide | null;
  trackId: string | null;
  playerId: string | null;
};

type TrackRow = {
  id: string;
  trackIndex: number;
  teamSide: TeamSide;
  playerId: string | null;
};

export async function buildPatch(
  tx: Tx,
  claim: LiveClaim,
  {
    events = [],
    corrected = [],
    tracks = [],
    removedTrackIds = [],
    added = null,
  }: {
    events?: ChangeRow[];
    /** Ids among `events` that now read "corrected". */
    corrected?: string[];
    tracks?: TrackRow[];
    removedTrackIds?: string[];
    added?: WorkspacePatch["added"];
  },
): Promise<WorkspacePatch> {
  const entries = await entryIdsByPlayer(tx, claim);
  const entryOf = (playerId: string | null) => (playerId ? (entries.get(playerId) ?? null) : null);
  const fixed = new Set(corrected);
  return {
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      onTarget: e.onTarget,
      status: e.status,
      side: sideOf(e.teamSide),
      trackId: e.trackId,
      entryId: entryOf(e.playerId),
      ...(fixed.has(e.id) && { corrected: true }),
    })),
    tracks: tracks.map((t): WorkspaceTrack => ({
      id: t.id,
      index: t.trackIndex,
      side: sideOf(t.teamSide),
      entryId: entryOf(t.playerId),
    })),
    removedTrackIds,
    added,
    counts: await claimCounts(tx, claim),
  };
}

export const TRACK_SELECT = { id: true, trackIndex: true, teamSide: true, playerId: true } as const;
