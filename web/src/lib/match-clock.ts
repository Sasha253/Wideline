import { formatVideoTime } from "./labels";

// Match time rules shared by the server (lineups, markers) and the client
// (marker tool, substitution form). Pure and client-safe
// (docs/build/design/C06.md, "Match minutes"; SQUAD06, MATCH05).

/** Extra minutes a substitution may fall after the regulation end (stoppage time). */
export const STOPPAGE_ALLOWANCE_MIN = 15;

/** A match lasts two halves. */
export function matchLengthMin(halfLengthMinutes: number): number {
  return 2 * halfLengthMinutes;
}

/** The latest minute a substitution may be entered at: 2 x half + 15. */
export function maxSubstitutionMinute(halfLengthMinutes: number): number {
  return matchLengthMin(halfLengthMinutes) + STOPPAGE_ALLOWANCE_MIN;
}

/** The time fields of a Lineup row: match seconds on and off. */
export type LineupTimes = { startedAt: number | null; endedAt: number | null };

/**
 * Whole minutes a player was on the pitch (SQUAD06). startedAt null is an
 * unused substitute (0). endedAt null means they finished the match. Both ends
 * are capped at the regulation length, so stoppage time does not add minutes:
 * a full match is 2 x half, as in the usual football stat.
 */
export function minutesPlayed(row: LineupTimes, halfLengthMinutes: number): number {
  if (row.startedAt === null) return 0;
  const end = matchLengthMin(halfLengthMinutes) * 60;
  const from = Math.min(Math.max(0, row.startedAt), end);
  const to = Math.min(row.endedAt ?? end, end);
  return Math.max(0, Math.round((to - from) / 60));
}

/** The four half-time offsets on Video, in video milliseconds (MATCH05). */
export const MARKER_KEYS = [
  "kickoffMs",
  "halfTimeMs",
  "secondHalfKickoffMs",
  "fullTimeMs",
] as const;
export type MarkerKey = (typeof MARKER_KEYS)[number];
export type Markers = Record<MarkerKey, number | null>;

export const MARKER_LABELS: Record<MarkerKey, string> = {
  kickoffMs: "Kickoff",
  halfTimeMs: "Half-time",
  secondHalfKickoffMs: "Second-half kickoff",
  fullTimeMs: "Full time",
};

// "{later} must be after {earlier}." Half-time to second-half kickoff may be
// equal (no break recorded), so that pair reads "at or after".
const ORDER_COPY: Record<string, string> = {
  "kickoffMs>halfTimeMs": "Half-time must be after kickoff.",
  "halfTimeMs>secondHalfKickoffMs": "Second-half kickoff must be at or after half-time.",
  "kickoffMs>secondHalfKickoffMs": "Second-half kickoff must be after kickoff.",
  "secondHalfKickoffMs>fullTimeMs": "Full time must be after second-half kickoff.",
  "halfTimeMs>fullTimeMs": "Full time must be after half-time.",
  "kickoffMs>fullTimeMs": "Full time must be after kickoff.",
};

export const MARKER_PARSE_ERROR = "Enter a time like 2:31 or 47:12.4.";

/** "The video ends at 92:14.0." */
export function markerPastEnd(durationMs: number): string {
  return `The video ends at ${formatVideoTime(durationMs)}.`;
}

/**
 * The order rule among the markers that are set: kickoff < half-time <=
 * second-half kickoff < full time. Each marker is compared with the nearest
 * earlier one that is set. Returns the first message per marker; empty when
 * the order holds. The database checks the same (CHECK "Video_markers_ordered").
 */
export function validateMarkers(m: Partial<Markers>): Partial<Record<MarkerKey, string>> {
  const errors: Partial<Record<MarkerKey, string>> = {};
  let previous: MarkerKey | null = null;
  for (const key of MARKER_KEYS) {
    const value = m[key];
    if (value === null || value === undefined) continue;
    if (value < 0) {
      errors[key] = MARKER_PARSE_ERROR;
      continue;
    }
    if (previous) {
      const before = m[previous]!;
      const inclusive = previous === "halfTimeMs" && key === "secondHalfKickoffMs";
      if (inclusive ? value < before : value <= before) {
        errors[key] = ORDER_COPY[`${previous}>${key}`];
      }
    }
    previous = key;
  }
  return errors;
}

/**
 * A typed video time to milliseconds: "2:31", "47:12.4", "112:31.0". Minutes
 * are not capped at 59. Null when it cannot be read.
 */
export function parseClock(raw: string): number | null {
  const m = /^\s*(\d{1,3}):([0-5]\d)(?:[.,](\d{1,3}))?\s*$/.exec(raw);
  if (!m) return null;
  const fraction = m[3] ? Number(m[3].padEnd(3, "0")) : 0;
  return (Number(m[1]) * 60 + Number(m[2])) * 1000 + fraction;
}

export type MatchPhase =
  "before_kickoff" | "first_half" | "half_time" | "second_half" | "after_full_time";

export const PHASE_LABELS: Record<MatchPhase, string> = {
  before_kickoff: "Before kickoff",
  first_half: "First half",
  half_time: "Half-time",
  second_half: "Second half",
  after_full_time: "After full time",
};

export type MatchClock = {
  phase: MatchPhase;
  /** The match clock, "31:24", or "45+1:30" in stoppage. Empty outside play. */
  label: string;
  /** In stoppage time, the minute as football writes it: "45+2". */
  stoppage: string | null;
};

const mmss = (ms: number) => formatVideoTime(ms, 0);

/**
 * Maps a video position to the match clock with the four markers. Needs
 * kickoff; returns null without it, or when the markers are out of order
 * (validateMarkers). The second half starts at {half}:00. Time past the end
 * of a half is stoppage: "45+2" is the second minute of added time.
 */
export function videoMsToMatchClock(
  ms: number,
  markers: Partial<Markers>,
  halfLengthMinutes: number,
): MatchClock | null {
  const { kickoffMs, halfTimeMs, secondHalfKickoffMs, fullTimeMs } = markers;
  if (kickoffMs === null || kickoffMs === undefined) return null;
  if (Object.keys(validateMarkers(markers)).length > 0) return null;
  const halfMs = halfLengthMinutes * 60_000;
  const outside = (phase: MatchPhase): MatchClock => ({ phase, label: "", stoppage: null });

  const clock = (elapsed: number, offsetMs: number, phase: MatchPhase): MatchClock => {
    if (elapsed < halfMs) return { phase, label: mmss(offsetMs + elapsed), stoppage: null };
    const over = elapsed - halfMs;
    const endMin = (offsetMs + halfMs) / 60_000;
    return {
      phase,
      label: `${endMin}+${mmss(over)}`,
      stoppage: `${endMin}+${Math.max(1, Math.ceil(over / 60_000))}`,
    };
  };

  if (ms < kickoffMs) return outside("before_kickoff");
  const has = (v: number | null | undefined): v is number => v !== null && v !== undefined;
  if (has(fullTimeMs) && ms >= fullTimeMs) return outside("after_full_time");
  if (has(secondHalfKickoffMs) && ms >= secondHalfKickoffMs) {
    return clock(ms - secondHalfKickoffMs, halfMs, "second_half");
  }
  if (has(halfTimeMs) && ms >= halfTimeMs) return outside("half_time");
  return clock(ms - kickoffMs, 0, "first_half");
}

/** A half's length from two markers, as "47 min (45+2)" parts. */
export function halfDuration(
  startMs: number,
  endMs: number,
  halfLengthMinutes: number,
  offsetMin: number,
): { minutes: number; clock: string } {
  const elapsed = endMs - startMs;
  const minutes = Math.round(elapsed / 60_000);
  const halfMs = halfLengthMinutes * 60_000;
  const end = offsetMin + halfLengthMinutes;
  const clock = elapsed > halfMs ? `${end}+${Math.ceil((elapsed - halfMs) / 60_000)}` : `${end}`;
  return { minutes, clock };
}
