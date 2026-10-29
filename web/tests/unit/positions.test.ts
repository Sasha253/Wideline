import { describe, expect, it } from "vitest";
import {
  averagePosition,
  distanceCovered,
  heatmapGrid,
  orientForTeam,
  smooth,
  type PitchPoint,
} from "@/lib/positions";

// C09 (CV08): the position maths shared by ingest and C12's stats.

const line = (n: number, step: number, dtMs = 200, y = 30): PitchPoint[] =>
  Array.from({ length: n }, (_, i) => ({ tMs: i * dtMs, x: 10 + i * step, y }));

describe("distanceCovered", () => {
  it("measures a straight 10 m run", () => {
    expect(distanceCovered(line(11, 1))).toBeCloseTo(10, 6);
  });

  it("skips steps faster than 12 m/s", () => {
    const pts = line(6, 1);
    pts.push({ tMs: 1200, x: 40, y: 30 }, { tMs: 1400, x: 41, y: 30 }, { tMs: 1600, x: 42, y: 30 });
    // The 25 m jump in 0.2 s is a tracking error, not running.
    expect(distanceCovered(pts)).toBeLessThan(10);
  });

  it("skips gaps longer than a second", () => {
    const a = line(6, 1);
    const b = line(6, 1).map((p) => ({ ...p, tMs: p.tMs + 5000, x: p.x + 8 }));
    expect(distanceCovered([...a, ...b])).toBeCloseTo(10, 6);
  });

  it("is zero for one point and for none", () => {
    expect(distanceCovered([])).toBe(0);
    expect(distanceCovered(line(1, 1))).toBe(0);
  });

  it("is not fooled by one jittery sample", () => {
    const pts = line(9, 0);
    pts[4] = { ...pts[4]!, y: 31.5 };
    expect(distanceCovered(pts)).toBe(0);
    expect(smooth(pts)[4]!.y).toBe(30);
  });
});

describe("heatmapGrid", () => {
  it("is 4 by 6 and its shares sum to 1", () => {
    const pts = [
      { tMs: 0, x: 1, y: 67 },
      { tMs: 1, x: 104, y: 1 },
      { tMs: 2, x: 52, y: 34 },
      { tMs: 3, x: 52, y: 34 },
    ];
    const grid = heatmapGrid(pts);
    expect(grid).toHaveLength(4);
    expect(grid.every((r) => r.length === 6)).toBe(true);
    expect(grid.flat().reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(grid[0]![0]).toBe(0.25); // far left corner: top row, first column
    expect(grid[3]![5]).toBe(0.25); // near right corner
  });

  it("is all zeros with no points", () => {
    expect(
      heatmapGrid([])
        .flat()
        .every((v) => v === 0),
    ).toBe(true);
  });
});

describe("averagePosition", () => {
  it("is the mean, or null", () => {
    expect(averagePosition([])).toBeNull();
    expect(averagePosition(line(3, 2))).toEqual({ x: 12, y: 30 });
  });
});

describe("orientForTeam", () => {
  const pts = [
    { tMs: 1000, x: 20, y: 10 },
    { tMs: 3_000_000, x: 20, y: 10 },
  ];
  const markers = { kickoffMs: 0, halfTimeMs: 2_700_000, secondHalfKickoffMs: 2_900_000 };

  it("flips at the second-half kickoff", () => {
    const out = orientForTeam(pts, markers, true);
    expect(out[0]).toEqual({ tMs: 1000, x: 20, y: 10 });
    expect(out[1]).toEqual({ tMs: 3_000_000, x: 85, y: 58 });
  });

  it("flips the first half for a team attacking left first", () => {
    const out = orientForTeam(pts, markers, false);
    expect(out[0]).toEqual({ tMs: 1000, x: 85, y: 58 });
    expect(out[1]).toEqual({ tMs: 3_000_000, x: 20, y: 10 });
  });

  it("treats every point as first half without markers", () => {
    const none = { kickoffMs: null, halfTimeMs: null, secondHalfKickoffMs: null };
    expect(orientForTeam(pts, none, true)).toEqual(pts);
  });
});
