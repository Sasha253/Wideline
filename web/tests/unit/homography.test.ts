import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyHomography,
  fitHomography,
  HomographyError,
  invert,
  PITCH_LANDMARKS,
  residuals,
  type Correspondence,
  type Vec2,
} from "@/lib/homography";

// C09 (CV05): the TypeScript DLT against the cases shared with
// cv_worker/tests/test_calibration.py.

type Point = { landmark: string; image: Vec2; pitch: Vec2 };
type Case = {
  name: string;
  points: Point[];
  errorM: number;
  probes: { image: Vec2; pitch: Vec2 }[];
};
type Failure = { name: string; points: Point[]; error: "too_few" | "degenerate" };

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/cv/homography-cases.json"), "utf8"),
) as { cases: Case[]; failures: Failure[] };

describe("fitHomography", () => {
  it.each(fixture.cases.map((c) => [c.name, c] as const))("fits %s as Python does", (_n, c) => {
    const { homography, errorM } = fitHomography(c.points);
    expect(errorM).toBeCloseTo(c.errorM, 4);
    for (const p of c.probes) {
      const [x, y] = applyHomography(homography, p.image);
      expect(x).toBeCloseTo(p.pitch[0], 3);
      expect(y).toBeCloseTo(p.pitch[1], 3);
    }
    // And back: the inverse puts the landmarks on the image.
    const inv = invert(homography);
    for (const p of c.points) {
      const [u, v] = applyHomography(inv, p.pitch);
      expect(Math.hypot(u - p.image[0], v - p.image[1])).toBeLessThan(6);
    }
  });

  it("reports the reprojection error per point", () => {
    const c = fixture.cases.find((x) => x.name.includes("noise"))!;
    const { homography, errorM } = fitHomography(c.points);
    const r = residuals(homography, c.points);
    const rms = Math.sqrt(r.reduce((n, v) => n + v * v, 0) / r.length);
    expect(rms).toBeCloseTo(errorM, 9);
    expect(errorM).toBeGreaterThan(0);
  });

  it.each(fixture.failures.map((c) => [c.name, c] as const))("refuses %s", (_n, c) => {
    let code: string | null = null;
    try {
      fitHomography(c.points);
    } catch (err) {
      expect(err).toBeInstanceOf(HomographyError);
      code = (err as HomographyError).code;
    }
    expect(code).toBe(c.error);
  });

  it("refuses fewer than 4 points", () => {
    const three: Correspondence[] = fixture.cases[0]!.points.slice(0, 3);
    expect(() => fitHomography(three)).toThrow(/at least 4/);
  });
});

describe("PITCH_LANDMARKS", () => {
  it("has the 23 landmarks of the design, each on the pitch, ids unique", () => {
    expect(PITCH_LANDMARKS).toHaveLength(23);
    expect(new Set(PITCH_LANDMARKS.map((l) => l.id)).size).toBe(23);
    for (const l of PITCH_LANDMARKS) {
      expect(l.pitch[0]).toBeGreaterThanOrEqual(0);
      expect(l.pitch[0]).toBeLessThanOrEqual(105);
      expect(l.pitch[1]).toBeGreaterThanOrEqual(0);
      expect(l.pitch[1]).toBeLessThanOrEqual(68);
    }
    expect(PITCH_LANDMARKS.find((l) => l.id === "centre_spot")!.label).toBe("Centre spot");
  });
});
