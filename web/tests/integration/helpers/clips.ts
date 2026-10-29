import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCvResult, type CvResult } from "@/server/cv/contract";
import type { IngestInput } from "@/server/cv/ingest";
import type { JobRef } from "@/server/processing/jobs";
import type { ClipCutter, CutInput } from "@/worker/clips";
import { FIXTURES_DIR } from "./matches";

// C09 fixtures: the committed golden synthetic result (cv_worker `make
// cv-golden`), an ingest input around it, and a fake clip cutter (no ffmpeg or
// object storage in CI).

export const GOLDEN = join(FIXTURES_DIR, "cv", "synthetic-result.json");
export const GOLDEN_TRUTH = join(FIXTURES_DIR, "cv", "synthetic-truth.csv");

/** The golden result, renamed to this job and match and checked against the contract. */
export function goldenResult(job: { id: string; matchId: string }): CvResult {
  const raw = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, unknown>;
  return parseCvResult(
    { ...raw, jobId: job.id, matchId: job.matchId },
    { jobId: job.id, matchId: job.matchId, durationMs: 90_000 },
  );
}

/** Track indexes of the golden result that read this side and shirt number. */
export function goldenTracks(r: CvResult, side: "home" | "away", number: number): number[] {
  return r.tracks
    .filter((t) => t.teamSide === side && t.shirtNumber === number)
    .map((t) => t.trackIndex);
}

export function ingestInput(job: JobRef, videoId: string, result: CvResult): IngestInput {
  return {
    job,
    videoId,
    result,
    resultKey: `orgs/${job.organisationId}/matches/${job.matchId}/cv/${job.id}/attempt-1/result.json`,
    resultBytes: 4096,
    resultSha256: "b".repeat(64),
    attempt: 1,
    provider: "fake",
    realtimeFactor: 0.2,
    startupMs: null,
  };
}

/** A cutter that records each cut and reports a size; `failOn` throws on that call (1-based). */
export function fakeCutter({ bytes = 250_000, failOn }: { bytes?: number; failOn?: number } = {}) {
  const cuts: CutInput[] = [];
  let calls = 0;
  const cutter: ClipCutter = {
    sourceUrl: async (blobPath) => `https://s3.test/${blobPath}?X-Amz-Signature=secret`,
    hasAudio: async () => false,
    cut: async (input) => {
      calls += 1;
      if (failOn !== undefined && calls === failOn) {
        throw new Error(`ffmpeg clip failed (exit code 1): could not read ${input.url}`);
      }
      cuts.push(input);
      return bytes;
    },
  };
  return { cutter, cuts };
}
