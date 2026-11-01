import type { EventStatus } from "@/generated/prisma/enums";
import type { AutoAcceptThresholds } from "./auto-accept";
import { eventTypeLabel, formatVideoTime } from "./labels";
import { videoMsToMatchClock, type Markers } from "./match-clock";

/**
 * The review workspace's data and its pure rules (C11; REVIEW03 to REVIEW07,
 * docs/build/design/C11.md). Client-safe: loadWorkspace() builds these on the
 * server and the workspace updates them after each write. Players appear only
 * as lineup entries (Lineup ids) with a who-label built on the server (Q-021):
 * the client never gets a player id, a name it may not show, or a consent state.
 */

export type ReviewSide = "home" | "away";
export type ReviewEventType = "goal" | "shot" | "touch";

/** One lineup entry: "#7 Thabo Nkosi" for a scout_visible player, else "Home #7". */
export type WorkspaceEntry = {
  id: string;
  side: ReviewSide;
  shirtNumber: number;
  label: string;
};

export type WorkspaceTrack = {
  id: string;
  /** The model's track number, "Track 22". */
  index: number;
  side: ReviewSide | null;
  /** The linked lineup entry, or null when unlinked. */
  entryId: string | null;
};

export type WorkspaceEvent = {
  id: string;
  timestampMs: number;
  type: ReviewEventType;
  onTarget: boolean | null;
  status: EventStatus;
  side: ReviewSide | null;
  trackId: string | null;
  entryId: string | null;
  confidence: number | null;
  clipId: string | null;
  clipStartMs: number | null;
  clipEndMs: number | null;
  /** Edited or reassigned in review (the "corrected" note). */
  corrected: boolean;
  /** Added by a reviewer (no CV job). */
  manual: boolean;
  /** Below its threshold when the workspace loaded: the default list (REVIEW03). */
  toCheck: boolean;
};

/** The fields a write changes on an event; the client merges them onto its row. */
export type EventChange = Pick<
  WorkspaceEvent,
  "id" | "type" | "onTarget" | "status" | "side" | "trackId" | "entryId"
> & { corrected?: boolean };

/** A write's result for the client: the rows it changed, and the claim's counts after it. */
export type WorkspacePatch = {
  events: EventChange[];
  tracks: WorkspaceTrack[];
  removedTrackIds: string[];
  added: WorkspaceEvent | null;
  counts: WorkspaceCounts;
};

/** Merges a write's event changes into the client's rows. */
export function applyPatch(
  events: readonly WorkspaceEvent[],
  patch: Pick<WorkspacePatch, "events" | "added">,
): WorkspaceEvent[] {
  const changes = new Map(patch.events.map((c) => [c.id, c]));
  const next = events.map((e) => {
    const c = changes.get(e.id);
    return c ? { ...e, ...c, corrected: c.corrected ?? e.corrected } : e;
  });
  if (patch.added && !next.some((e) => e.id === patch.added!.id)) next.push(patch.added);
  return next;
}

export type WorkspaceCounts = { eventsReviewed: number; corrections: number; added: number };

export type WorkspaceFacts = {
  thresholds: AutoAcceptThresholds;
  sidesUnconfirmed: boolean;
  favouritedClipIds: string[];
  counts: WorkspaceCounts;
};

/** "Home team", "Away team". */
export const SIDE_TEAM: Record<ReviewSide, string> = { home: "Home team", away: "Away team" };

/** The who-label of an event (Q-021, design "Who-labels"). */
export function eventWho(
  e: Pick<WorkspaceEvent, "entryId" | "trackId" | "side">,
  entries: ReadonlyMap<string, WorkspaceEntry>,
  tracks: ReadonlyMap<string, WorkspaceTrack>,
): string {
  const entry = e.entryId ? entries.get(e.entryId) : undefined;
  if (entry) return entry.label;
  const track = e.trackId ? tracks.get(e.trackId) : undefined;
  if (track) return `Unlinked track ${track.index}`;
  return e.side ? SIDE_TEAM[e.side] : "No player";
}

/** Whether the markers give a match clock at all (kickoff set, in order). */
export function hasMatchClock(markers: Partial<Markers>, halfLengthMinutes: number): boolean {
  return videoMsToMatchClock(markers.kickoffMs ?? 0, markers, halfLengthMinutes) !== null;
}

/** "31:24" match time, or the video time when there is no clock or it is outside play. */
export function eventTime(
  ms: number,
  markers: Partial<Markers>,
  halfLengthMinutes: number,
): string {
  const clock = videoMsToMatchClock(ms, markers, halfLengthMinutes);
  return clock?.label ? clock.label : formatVideoTime(ms, 0);
}

export function eventTypeText(e: Pick<WorkspaceEvent, "type" | "onTarget">): string {
  return eventTypeLabel(e.type, e.onTarget);
}

/** The list order: by timestamp, then id, so the order is stable. */
export function byTime(a: WorkspaceEvent, b: WorkspaceEvent): number {
  return a.timestampMs - b.timestampMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The rows the list shows: the to-check set and manual events, plus auto-accepted ones when asked. */
export function visibleEvents(
  events: readonly WorkspaceEvent[],
  showAuto: boolean,
): WorkspaceEvent[] {
  return events.filter((e) => showAuto || e.toCheck || e.manual).sort(byTime);
}

/** "8 of 12 checked": to-check CV events no longer pending (manual events do not count). */
export function progress(events: readonly WorkspaceEvent[]): { checked: number; total: number } {
  const set = events.filter((e) => e.toCheck && !e.manual);
  return {
    checked: set.filter((e) => e.status !== "pending_review").length,
    total: set.length,
  };
}

export function pendingCount(events: readonly WorkspaceEvent[]): number {
  return events.filter((e) => e.status === "pending_review").length;
}

/**
 * Auto-advance after a decision (design "Decisions and auto-advance"): the
 * next pending_review row after `fromId` in list order, else the first one
 * from the top, else stay on `fromId`.
 */
export function nextPendingId(
  rows: readonly WorkspaceEvent[],
  fromId: string | null,
): string | null {
  const at = rows.findIndex((r) => r.id === fromId);
  const after = rows.slice(at + 1).find((r) => r.status === "pending_review");
  if (after) return after.id;
  const first = rows.find((r) => r.status === "pending_review" && r.id !== fromId);
  return first?.id ?? fromId;
}

/** The first pending_review row, else the first row, else null (the selection on load). */
export function initialSelection(rows: readonly WorkspaceEvent[]): string | null {
  return rows.find((r) => r.status === "pending_review")?.id ?? rows[0]?.id ?? null;
}

/** J and K: the neighbour in list order, or null at the ends (no wrapping). */
export function neighbourId(
  rows: readonly WorkspaceEvent[],
  fromId: string | null,
  step: 1 | -1,
): string | null {
  const at = rows.findIndex((r) => r.id === fromId);
  if (at < 0) return rows[0]?.id ?? null;
  return rows[at + step]?.id ?? null;
}

/** Where selecting an event seeks the video: its clip start, or 5 s before it, at 0 or later. */
export function cueMs(e: Pick<WorkspaceEvent, "clipStartMs" | "timestampMs">): number {
  return Math.max(0, e.clipStartMs ?? e.timestampMs - 5000);
}

/** "6 events", "1 event". */
export function eventsText(n: number): string {
  return n === 1 ? "1 event" : `${n} events`;
}

/** The six watermark positions, in drift order (design "Watermark"). */
export const WATERMARK_POSITIONS = ["tl", "tr", "mr", "br", "bl", "ml"] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

/** The start position, from the claim id, so it differs between claims but not between renders. */
export function watermarkStart(claimId: string): number {
  let h = 0;
  for (const ch of claimId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % WATERMARK_POSITIONS.length;
}

/** "Claim 4F7K2Q": the last 6 characters of the claim id, upper case. */
export function shortClaimId(claimId: string): string {
  return claimId.slice(-6).toUpperCase();
}

/**
 * Q-041: whether the CV job's shirt-number evidence settles which team is
 * home. Draft rule: the winning reading needs SIDE_EVIDENCE_MARGIN more
 * matched numbers than the other. With no number reader (Q-039) both counts
 * are 0, so the sides are unconfirmed and the scout gets "Swap home and away".
 */
export const SIDE_EVIDENCE_MARGIN = 2;

export function sidesConfirmed(evidence: { kept: number; swapped: number } | null): boolean {
  if (!evidence) return false;
  return Math.abs(evidence.kept - evidence.swapped) >= SIDE_EVIDENCE_MARGIN;
}
