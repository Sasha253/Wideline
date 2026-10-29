import { describe, expect, it } from "vitest";
import { AUTO_ACCEPT_DEFAULTS } from "@/lib/auto-accept";
import { formatRate } from "@/lib/labels";
import {
  greedyMatch,
  matchRecall,
  meetsTarget,
  nearest,
  rates,
  type Detection,
  type Tag,
} from "@/server/lab/recall";

// C09 (Q-046): recall against hand tags, as the Lab and the v0 gate read it.

let n = 0;
const tag = (type: Tag["type"], t: number, onTarget: boolean | null = null): Tag => ({
  id: `t${++n}`,
  type,
  timestampMs: t,
  onTarget,
});
const det = (
  type: Detection["type"],
  t: number,
  confidence = 0.95,
  onTarget: boolean | null = null,
): Detection => ({ id: `d${++n}`, type, timestampMs: t, onTarget, confidence });

const row = (r: ReturnType<typeof matchRecall>, type: string) =>
  r.rows.find((x) => x.type === type)!;

describe("greedyMatch", () => {
  it("pairs closest first, one to one", () => {
    // Two tags 1 s apart, one detection between them nearer the second.
    const pairs = greedyMatch(
      [{ timestampMs: 1000 }, { timestampMs: 2000 }],
      [{ timestampMs: 1600 }],
      2000,
    );
    expect(pairs).toEqual([[1, 0]]);
  });
});

describe("matchRecall", () => {
  it("matches within 2 s for goals and shots and 1 s for touches, edges included", () => {
    const r = matchRecall(
      [det("goal", 12_000), det("shot", 30_000), det("touch", 50_000), det("touch", 61_001)],
      [tag("goal", 10_000), tag("shot", 32_001), tag("touch", 51_000), tag("touch", 60_000)],
      AUTO_ACCEPT_DEFAULTS,
    );
    expect(row(r, "goal")).toMatchObject({ tagged: 1, detected: 1, matched: 1 });
    expect(row(r, "shot")).toMatchObject({ tagged: 1, detected: 1, matched: 0 });
    expect(row(r, "touch")).toMatchObject({ tagged: 2, detected: 2, matched: 1 });
    expect(r.missed.map((t) => t.type)).toEqual(["shot", "touch"]);
    expect(r.unmatched.map((d) => d.type)).toEqual(["shot", "touch"]);
  });

  it("needs onTarget on both sides for the shot on target row", () => {
    const r = matchRecall(
      [det("shot", 1000, 0.9, true), det("shot", 20_000, 0.9, false)],
      [tag("shot", 1000, true), tag("shot", 20_000, true)],
      AUTO_ACCEPT_DEFAULTS,
    );
    expect(row(r, "shot")).toMatchObject({ tagged: 2, matched: 2 });
    expect(row(r, "shot_on_target")).toMatchObject({ tagged: 2, detected: 1, matched: 1 });
  });

  it("works out precision and the auto-accepted recall", () => {
    const r = matchRecall(
      [det("shot", 1000, 0.9), det("shot", 5000, 0.5), det("shot", 9000, 0.9)],
      [tag("shot", 1000), tag("shot", 5000)],
      AUTO_ACCEPT_DEFAULTS,
    );
    const shot = row(r, "shot");
    expect(shot).toMatchObject({ tagged: 2, detected: 3, matched: 2, autoMatched: 1 });
    expect(rates(shot)).toEqual({ recall: 1, precision: 2 / 3, autoRecall: 0.5 });
  });

  it("has no rates and no target with no tags", () => {
    const r = matchRecall([det("goal", 1000)], [], AUTO_ACCEPT_DEFAULTS);
    const goal = row(r, "goal");
    expect(rates(goal).recall).toBeNull();
    expect(meetsTarget(goal)).toBeNull();
    expect(r.missed).toEqual([]);
    expect(r.unmatched).toHaveLength(1);
  });

  it("reads 94.6% as below the 95% target", () => {
    const tags = Array.from({ length: 37 }, (_, i) => tag("shot", i * 10_000));
    const dets = tags.slice(0, 35).map((t) => det("shot", t.timestampMs));
    const shot = row(matchRecall(dets, tags, AUTO_ACCEPT_DEFAULTS), "shot");
    expect(meetsTarget(shot)).toBe(false);
    expect(formatRate(shot.matched, shot.tagged)).toBe("94%");
    expect(formatRate(0, 0)).toBeNull();
  });
});

describe("nearest", () => {
  it("finds the closest detection of the same type", () => {
    const t = tag("goal", 10_000);
    expect(
      nearest(t, [det("goal", 30_000), det("shot", 10_000), det("goal", 14_000)])!.timestampMs,
    ).toBe(14_000);
    expect(nearest(t, [det("shot", 10_000)])).toBeNull();
  });
});
