/**
 * Position maths (C09; CV08), shared by CV ingest and the stats of C12. Pure
 * and client-safe. Points are pitch metres on the 105 x 68 pitch, camera-fixed
 * as stored (x = 0 at the goal on the camera's left, y = 0 on the near
 * touchline, Q-043); orientForTeam() turns them into the PRD's frame (the team
 * attacks left to right) at read time.
 */

export const PITCH_LENGTH_M = 105;
export const PITCH_WIDTH_M = 68;
/** Faster than this between two samples is a tracking jump, not running. */
export const MAX_SPEED_MPS = 12;
/** A gap longer than this is not run across: the player was not seen. */
export const MAX_GAP_MS = 1000;
/** The PitchHeatmap layout (D01): 4 rows by 6 columns. */
export const HEATMAP_ROWS = 4;
export const HEATMAP_COLS = 6;

export type PitchPoint = { tMs: number; x: number; y: number };

/**
 * Rolling median of 5 (two each side), so one jittery sample does not add
 * metres. Near the ends the window shrinks evenly, so a straight run stays
 * straight.
 */
export function smooth(points: readonly PitchPoint[], window = 5): PitchPoint[] {
  const half = Math.floor(window / 2);
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };
  return points.map((p, i) => {
    const r = Math.min(half, i, points.length - 1 - i);
    const near = points.slice(i - r, i + r + 1);
    return { tMs: p.tMs, x: median(near.map((q) => q.x)), y: median(near.map((q) => q.y)) };
  });
}

/** Splits time-sorted points where a gap is longer than MAX_GAP_MS. */
function runs(points: readonly PitchPoint[]): PitchPoint[][] {
  const out: PitchPoint[][] = [];
  let run: PitchPoint[] = [];
  for (const p of points) {
    if (run.length && p.tMs - run[run.length - 1]!.tMs > MAX_GAP_MS) {
      out.push(run);
      run = [];
    }
    run.push(p);
  }
  if (run.length) out.push(run);
  return out;
}

/**
 * Metres covered along the points: each step counts unless it is faster than
 * 12 m/s or spans more than 1 s. Each run between gaps is smoothed on its own.
 */
export function distanceCovered(points: readonly PitchPoint[]): number {
  const sorted = [...points].sort((a, b) => a.tMs - b.tMs);
  let total = 0;
  for (const run of runs(sorted)) {
    const s = smooth(run);
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1]!;
      const b = s[i]!;
      const dt = b.tMs - a.tMs;
      if (dt <= 0) continue;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if ((d / dt) * 1000 > MAX_SPEED_MPS) continue;
      total += d;
    }
  }
  return total;
}

/**
 * The share of points in each cell of a rows x cols grid over the pitch, row
 * 0 at y = 68 (the far touchline, the top of the PitchHeatmap) and column 0 at
 * x = 0. Shares sum to 1; no points give all zeros.
 */
export function heatmapGrid(
  points: readonly PitchPoint[],
  { rows = HEATMAP_ROWS, cols = HEATMAP_COLS }: { rows?: number; cols?: number } = {},
): number[][] {
  const grid = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  if (points.length === 0) return grid;
  for (const p of points) {
    const c = Math.min(cols - 1, Math.max(0, Math.floor((p.x / PITCH_LENGTH_M) * cols)));
    const fromTop = PITCH_WIDTH_M - p.y;
    const r = Math.min(rows - 1, Math.max(0, Math.floor((fromTop / PITCH_WIDTH_M) * rows)));
    grid[r]![c]! += 1;
  }
  return grid.map((row) => row.map((n) => n / points.length));
}

/** The mean position, or null with no points. */
export function averagePosition(points: readonly PitchPoint[]): { x: number; y: number } | null {
  if (points.length === 0) return null;
  const x = points.reduce((n, p) => n + p.x, 0) / points.length;
  const y = points.reduce((n, p) => n + p.y, 0) / points.length;
  return { x, y };
}

export type HalfMarkers = {
  kickoffMs: number | null;
  halfTimeMs: number | null;
  secondHalfKickoffMs: number | null;
};

/**
 * Turns camera-fixed points into the team's attacking frame (Q-043): the team
 * attacks towards x = 105. `attacksRightFirst` says whether the team attacked
 * the camera's right goal in the first half; the sides swap from the
 * second-half kickoff (or half-time when only that is set). Without markers
 * every point is treated as first half. Points before kickoff are kept as
 * first half.
 */
export function orientForTeam(
  points: readonly PitchPoint[],
  markers: HalfMarkers,
  attacksRightFirst: boolean,
): PitchPoint[] {
  const swapAt = markers.secondHalfKickoffMs ?? markers.halfTimeMs;
  return points.map((p) => {
    const secondHalf = swapAt !== null && p.tMs >= swapAt;
    const attacksRight = secondHalf ? !attacksRightFirst : attacksRightFirst;
    return attacksRight
      ? { ...p }
      : { tMs: p.tMs, x: PITCH_LENGTH_M - p.x, y: PITCH_WIDTH_M - p.y };
  });
}
