// No "server-only" marker: the worker (plain Node, src/worker/) validates results.
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import schema from "./contract/cv-result-1.0.schema.json";

/**
 * The CV result contract (C08; PRD page 19): the one versioned JSON file the
 * worker writes to object storage. Every result is checked against the JSON
 * Schema (cv-result-1.0.schema.json, draft 2020-12; the Python worker bundles
 * an identical copy), then against the rules a schema cannot state: it names
 * this job and match, track indexes are unique, every event's track exists,
 * times fall inside the footage, clip windows hold their event, and each
 * track's points run forward in time.
 *
 * A worker change that adds or changes fields bumps schemaVersion in both
 * copies and adds it to SUPPORTED_SCHEMA_VERSIONS with its own schema.
 */

export const SUPPORTED_SCHEMA_VERSIONS = ["1.0"] as const;

/** The largest result file the dispatcher reads (checked with HeadObject before download). */
export const MAX_RESULT_BYTES = 256 * 1024 * 1024;

/** Events and points may sit this far past the probed duration (frame rounding). */
const DURATION_SLACK_MS = 1000;

/** At most this many schema error paths are kept: paths only, never values. */
const MAX_ERRORS = 5;

export type CvTeamSide = "home" | "away" | "unknown";
export type CvEventType = "goal" | "shot" | "touch";

export type CvPoint = { tMs: number; x: number; y: number };

export type CvTrack = {
  trackIndex: number;
  teamSide: CvTeamSide;
  shirtNumber: number | null;
  shirtConfidence: number | null;
  points: CvPoint[];
};

export type CvEvent = {
  type: CvEventType;
  trackIndex: number | null;
  tMs: number;
  x: number | null;
  y: number | null;
  confidence: number;
  onTarget?: boolean;
  clipStartMs: number;
  clipEndMs: number;
};

export type CvResult = {
  schemaVersion: (typeof SUPPORTED_SCHEMA_VERSIONS)[number];
  jobId: string;
  matchId: string;
  modelVersions: { detector: string; tracker: string; events: string } & Record<string, string>;
  video: { durationSec: number; fps: number; sampledFps: number };
  calibration: { confidence: number; homography: number[][] };
  tracks: CvTrack[];
  events: CvEvent[];
  warnings: string[];
};

/** A result that broke the contract. `errors` are short codes and JSON paths, no values. */
export class CvResultInvalid extends Error {
  constructor(readonly errors: string[]) {
    super(`CV result invalid: ${errors.join("; ")}`);
    this.name = "CvResultInvalid";
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile<CvResult>(schema);

function describe(e: ErrorObject): string {
  const path = e.instancePath || "/";
  if (e.keyword === "required") {
    return `${path} missing ${(e.params as { missingProperty: string }).missingProperty}`;
  }
  if (e.keyword === "additionalProperties") {
    return `${path} unexpected ${(e.params as { additionalProperty: string }).additionalProperty}`;
  }
  return `${path} ${e.keyword}`;
}

/** The JSON Schema check alone: the parsed result, or the error paths. */
export function checkSchema(
  json: unknown,
): { ok: true; result: CvResult } | { ok: false; errors: string[] } {
  if (validate(json)) return { ok: true, result: json };
  const errors = [...new Set((validate.errors ?? []).map(describe))].slice(0, MAX_ERRORS);
  return { ok: false, errors };
}

/** The rules beyond the schema. Returns problems as codes with indexes, no values. */
export function semanticProblems(
  r: CvResult,
  expected: { jobId: string; matchId: string; durationMs: number | null },
): string[] {
  const problems: string[] = [];
  if (r.jobId !== expected.jobId) problems.push("jobId does not match the job");
  if (r.matchId !== expected.matchId) problems.push("matchId does not match the job");
  const limit = expected.durationMs === null ? null : expected.durationMs + DURATION_SLACK_MS;

  const indexes = new Set<number>();
  r.tracks.forEach((t, i) => {
    if (indexes.has(t.trackIndex)) problems.push(`/tracks/${i} duplicate trackIndex`);
    indexes.add(t.trackIndex);
    for (let p = 0; p < t.points.length; p++) {
      const pt = t.points[p]!;
      if (p > 0 && pt.tMs <= t.points[p - 1]!.tMs) {
        problems.push(`/tracks/${i}/points/${p} not after the previous point`);
        break;
      }
      if (limit !== null && pt.tMs > limit) {
        problems.push(`/tracks/${i}/points/${p} after the end of the footage`);
        break;
      }
    }
  });
  r.events.forEach((e, i) => {
    if (e.trackIndex !== null && !indexes.has(e.trackIndex)) {
      problems.push(`/events/${i} names a track that is not in the result`);
    }
    if (limit !== null && e.tMs > limit) problems.push(`/events/${i} after the end of the footage`);
    if (!(e.clipStartMs <= e.tMs && e.tMs <= e.clipEndMs)) {
      problems.push(`/events/${i} clip window does not hold the event`);
    }
  });
  return problems.slice(0, MAX_ERRORS);
}

/**
 * Parses a result for this job: the schema first, then the semantic rules.
 * Throws CvResultInvalid with at most 5 problems.
 */
export function parseCvResult(
  json: unknown,
  expected: { jobId: string; matchId: string; durationMs: number | null },
): CvResult {
  const checked = checkSchema(json);
  if (!checked.ok) throw new CvResultInvalid(checked.errors);
  const problems = semanticProblems(checked.result, expected);
  if (problems.length) throw new CvResultInvalid(problems);
  return checked.result;
}
