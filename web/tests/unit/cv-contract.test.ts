import { describe, expect, it } from "vitest";
import { checkSchema, CvResultInvalid, parseCvResult, type CvResult } from "@/server/cv/contract";

// C08 acceptance: the schema rejects a result with a missing field. The PRD
// page-19 sample is valid; every required field, at every level, is required;
// values out of range and the rules beyond the schema are refused. Errors name
// paths, never values.

const expected = { jobId: "job_01HQ", matchId: "match_01HQ", durationMs: 5_820_000 };

function sample(): CvResult {
  return {
    schemaVersion: "1.0",
    jobId: "job_01HQ",
    matchId: "match_01HQ",
    modelVersions: {
      detector: "rfdetr-1.2",
      tracker: "bytetrack-0.4",
      events: "wideline-events-0.3",
    },
    video: { durationSec: 5820, fps: 25, sampledFps: 5 },
    calibration: {
      confidence: 0.91,
      homography: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    },
    tracks: [
      {
        trackIndex: 14,
        teamSide: "home",
        shirtNumber: 7,
        shirtConfidence: 0.42,
        points: [{ tMs: 12000, x: 48.2, y: 31.7 }],
      },
    ],
    events: [
      {
        type: "shot",
        trackIndex: 14,
        tMs: 1832400,
        x: 88.1,
        y: 34.0,
        confidence: 0.81,
        onTarget: true,
        clipStartMs: 1827400,
        clipEndMs: 1835400,
      },
    ],
    warnings: ["ball not visible for 142s total"],
  };
}

/** A copy of the sample with one field removed at a dotted path. */
function without(path: string): unknown {
  const r = structuredClone(sample()) as unknown as Record<string, unknown>;
  const keys = path.split(".");
  let node: Record<string, unknown> = r;
  for (const k of keys.slice(0, -1)) node = node[k] as Record<string, unknown>;
  delete node[keys.at(-1)!];
  return r;
}

const reject = (json: unknown) => () => parseCvResult(json, expected);

describe("the PRD sample", () => {
  it("is a valid result", () => {
    expect(parseCvResult(sample(), expected).events[0]!.type).toBe("shot");
  });
});

describe("missing fields (acceptance)", () => {
  it.each([
    "schemaVersion",
    "jobId",
    "matchId",
    "modelVersions",
    "modelVersions.detector",
    "video",
    "video.durationSec",
    "calibration",
    "calibration.homography",
    "tracks",
    "events",
    "warnings",
    "tracks.0.trackIndex",
    "tracks.0.teamSide",
    "tracks.0.shirtNumber",
    "tracks.0.points",
    "tracks.0.points.0.tMs",
    "tracks.0.points.0.x",
    "events.0.type",
    "events.0.trackIndex",
    "events.0.confidence",
    "events.0.clipStartMs",
    "events.0.clipEndMs",
    "events.0.onTarget",
  ])("rejects a result without %s", (path) => {
    expect(reject(without(path))).toThrow(CvResultInvalid);
  });

  it("names the missing field by path", () => {
    const checked = checkSchema(without("tracks.0.teamSide"));
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.errors).toContain("/tracks/0 missing teamSide");
  });
});

describe("values the schema refuses", () => {
  it.each<[string, (r: CvResult) => void]>([
    ["an unknown schemaVersion", (r) => ((r as { schemaVersion: string }).schemaVersion = "2.0")],
    ["an extra property", (r) => ((r as unknown as Record<string, unknown>).players = [])],
    [
      "an extra event property",
      (r) => ((r.events[0] as unknown as Record<string, unknown>).playerName = "x"),
    ],
    ["x off the pitch", (r) => (r.tracks[0]!.points[0]!.x = 105.5)],
    ["y off the pitch", (r) => (r.events[0]!.y = -1)],
    ["confidence above 1", (r) => (r.events[0]!.confidence = 1.2)],
    ["an unknown event type", (r) => ((r.events[0] as { type: string }).type = "pass")],
    ["onTarget on a goal", (r) => (r.events[0]!.type = "goal")],
    ["a shirt number above 99", (r) => (r.tracks[0]!.shirtNumber = 100)],
    ["a fractional time", (r) => (r.events[0]!.tMs = 1.5)],
  ])("rejects %s", (_name, change) => {
    const r = sample();
    change(r);
    expect(reject(r)).toThrow(CvResultInvalid);
  });

  it("never echoes values in the error", () => {
    const r = sample();
    (r.events[0] as unknown as Record<string, unknown>).playerName = "Thabo Nkosi";
    try {
      parseCvResult(r, expected);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain("Thabo");
      expect((err as Error).message).toContain("/events/0 unexpected playerName");
    }
  });
});

describe("rules beyond the schema", () => {
  it.each<[string, (r: CvResult) => void]>([
    ["another job's id", (r) => (r.jobId = "job_other")],
    ["another match's id", (r) => (r.matchId = "match_other")],
    ["a duplicate trackIndex", (r) => r.tracks.push({ ...structuredClone(r.tracks[0]!) })],
    ["an event on a missing track", (r) => (r.events[0]!.trackIndex = 99)],
    ["a clip window that misses the event", (r) => (r.events[0]!.clipEndMs = 1830000)],
    [
      "an event after the footage ends",
      (r) => {
        r.events[0]!.tMs = 6_000_000;
        r.events[0]!.clipStartMs = 5_999_000;
        r.events[0]!.clipEndMs = 6_001_000;
      },
    ],
    ["points out of order", (r) => r.tracks[0]!.points.push({ tMs: 11000, x: 1, y: 1 })],
  ])("rejects %s", (_name, change) => {
    const r = sample();
    change(r);
    expect(reject(r)).toThrow(CvResultInvalid);
  });

  it("allows events with no track, and a null position", () => {
    const r = sample();
    r.events.push({
      type: "goal",
      trackIndex: null,
      tMs: 2_000_000,
      x: null,
      y: null,
      confidence: 0.95,
      clipStartMs: 1_995_000,
      clipEndMs: 2_003_000,
    });
    expect(parseCvResult(r, expected).events).toHaveLength(2);
  });

  it("skips the duration check when the footage length is unknown", () => {
    const r = sample();
    r.events[0]!.tMs = 9_000_000;
    r.events[0]!.clipStartMs = 8_999_000;
    r.events[0]!.clipEndMs = 9_001_000;
    expect(() => parseCvResult(r, { ...expected, durationMs: null })).not.toThrow();
  });
});
