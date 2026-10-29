// Pure, so the Lab pages, the benchmark aggregate and the tests share it.
import type { AutoAcceptThresholds } from "@/lib/auto-accept";

/**
 * Detector recall against hand tags (C09; Q-046, the v0 gate). A detection
 * matches a tag when it is the same type and within 2 s (goals and shots) or
 * 1 s (touches); matching is greedy and one-to-one, closest pairs first. The
 * "shot on target" row matches shot tags marked onTarget against shots the
 * pipeline called on target. Every CV event of the run counts, whatever its
 * review status; auto-accepted recall counts only matched detections at or
 * above their type's auto-accept threshold. Manual events never count.
 */

export type LabEventType = "goal" | "shot" | "touch";
export type RecallRowType = "goal" | "shot" | "shot_on_target" | "touch";
export const RECALL_ROWS: readonly RecallRowType[] = ["goal", "shot", "shot_on_target", "touch"];
/** The v0 gate: 95% of tagged goals and shots found. */
export const RECALL_TARGET = 0.95;
export const GATED_ROWS: ReadonlySet<RecallRowType> = new Set(["goal", "shot"]);
export const RECALL_TOLERANCE_MS: Record<LabEventType, number> = {
  goal: 2000,
  shot: 2000,
  touch: 1000,
};

export type Detection = {
  id: string;
  type: LabEventType;
  timestampMs: number;
  onTarget: boolean | null;
  confidence: number | null;
};

export type Tag = {
  id: string;
  type: LabEventType;
  timestampMs: number;
  onTarget: boolean | null;
};

export type RecallRow = {
  type: RecallRowType;
  tagged: number;
  detected: number;
  matched: number;
  autoMatched: number;
};

export type MatchRecall = {
  rows: RecallRow[];
  /** Tags of goal, shot and touch with no matching detection. */
  missed: Tag[];
  /** Detections of goal, shot and touch that match no tag. */
  unmatched: Detection[];
};

function baseType(row: RecallRowType): LabEventType {
  return row === "shot_on_target" ? "shot" : row;
}

/** Greedy one-to-one matching by time: closest pairs first, ties by tag then detection order. */
export function greedyMatch(
  tags: readonly { timestampMs: number }[],
  found: readonly { timestampMs: number }[],
  toleranceMs: number,
): [number, number][] {
  const pairs: [number, number, number][] = [];
  tags.forEach((t, i) =>
    found.forEach((d, j) => {
      const gap = Math.abs(t.timestampMs - d.timestampMs);
      if (gap <= toleranceMs) pairs.push([gap, i, j]);
    }),
  );
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const usedTag = new Set<number>();
  const usedFound = new Set<number>();
  const out: [number, number][] = [];
  for (const [, i, j] of pairs) {
    if (usedTag.has(i) || usedFound.has(j)) continue;
    usedTag.add(i);
    usedFound.add(j);
    out.push([i, j]);
  }
  return out;
}

export function matchRecall(
  detections: readonly Detection[],
  tags: readonly Tag[],
  thresholds: AutoAcceptThresholds,
): MatchRecall {
  const rows: RecallRow[] = [];
  const missed: Tag[] = [];
  const unmatched: Detection[] = [];
  for (const type of RECALL_ROWS) {
    const base = baseType(type);
    const onTargetOnly = type === "shot_on_target";
    const t = tags.filter((x) => x.type === base && (!onTargetOnly || x.onTarget === true));
    const d = detections.filter((x) => x.type === base && (!onTargetOnly || x.onTarget === true));
    const pairs = greedyMatch(t, d, RECALL_TOLERANCE_MS[base]);
    const autoMatched = pairs.filter(([, j]) => (d[j]!.confidence ?? 0) >= thresholds[base]).length;
    rows.push({
      type,
      tagged: t.length,
      detected: d.length,
      matched: pairs.length,
      autoMatched,
    });
    if (!onTargetOnly) {
      const hitTags = new Set(pairs.map(([i]) => i));
      const hitFound = new Set(pairs.map(([, j]) => j));
      t.forEach((x, i) => !hitTags.has(i) && missed.push(x));
      d.forEach((x, j) => !hitFound.has(j) && unmatched.push(x));
    }
  }
  const order: Record<LabEventType, number> = { goal: 0, shot: 1, touch: 2 };
  const byTypeThenTime = <T extends { type: LabEventType; timestampMs: number }>(a: T, b: T) =>
    order[a.type] - order[b.type] || a.timestampMs - b.timestampMs;
  return { rows, missed: missed.sort(byTypeThenTime), unmatched: unmatched.sort(byTypeThenTime) };
}

/** recall, precision and auto-accepted recall as shares, null where undefined. */
export function rates(row: RecallRow): {
  recall: number | null;
  precision: number | null;
  autoRecall: number | null;
} {
  return {
    recall: row.tagged ? row.matched / row.tagged : null,
    precision: row.detected ? row.matched / row.detected : null,
    autoRecall: row.tagged ? row.autoMatched / row.tagged : null,
  };
}

/** True when a gated row meets the 95% target; null for rows with no target or no tags. */
export function meetsTarget(row: RecallRow): boolean | null {
  if (!GATED_ROWS.has(row.type) || row.tagged === 0) return null;
  return row.matched / row.tagged >= RECALL_TARGET;
}

/** The closest detection of the same type to a tag, for the missed list. */
export function nearest(tag: Tag, detections: readonly Detection[]): Detection | null {
  let best: Detection | null = null;
  for (const d of detections) {
    if (d.type !== tag.type) continue;
    if (
      !best ||
      Math.abs(d.timestampMs - tag.timestampMs) < Math.abs(best.timestampMs - tag.timestampMs)
    ) {
      best = d;
    }
  }
  return best;
}
