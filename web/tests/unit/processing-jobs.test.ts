import { Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

// C07 (NFR30, NFR31): the ProcessingJob rules that need no database. The last
// attempt is the one pg-boss will not retry; error text never carries a signed
// URL and is capped; job log lines carry ids, attempts and timings, never names.

const lines = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/server/log", async () => {
  const pino = (await import("pino")).default;
  const { logOptions } = await vi.importActual<typeof import("@/server/log")>("@/server/log");
  const sink = new Writable({
    write(chunk, _enc, done) {
      for (const l of String(chunk).split("\n").filter(Boolean)) lines.push(JSON.parse(l));
      done();
    },
  });
  return { log: pino(logOptions, sink), logOptions };
});

const { ERROR_MESSAGE_MAX, failureUpdate, isFinalAttempt, jobLog, redactJobError } =
  await import("@/server/processing/jobs");

const URL_SIGNED =
  "http://rustfs:9000/wideline/orgs/o1/matches/m1/raw/v1.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=KEY%2F20261026&X-Amz-Signature=abc123";

describe("isFinalAttempt and failureUpdate", () => {
  it("marks failed only when retryCount reaches retryLimit", () => {
    expect(isFinalAttempt(0, 2)).toBe(false);
    expect(isFinalAttempt(1, 2)).toBe(false);
    expect(isFinalAttempt(2, 2)).toBe(true);
    expect(isFinalAttempt(3, 2)).toBe(true);
    const now = new Date("2026-10-26T12:00:00Z");
    expect(failureUpdate({ final: false, error: "x" }, now)).toEqual({
      status: "queued",
      errorMessage: "x",
      finishedAt: null,
    });
    expect(failureUpdate({ final: true, error: "x" }, now)).toEqual({
      status: "failed",
      errorMessage: "x",
      finishedAt: now,
    });
  });
});

describe("redactJobError", () => {
  it("removes the signed URL and any other query string", () => {
    const err = new Error(
      `ffmpeg failed (exit code 1): ${URL_SIGNED}: Server returned 403 Forbidden\nhttps://other.example/x.mp4?X-Amz-Signature=def`,
    );
    const out = redactJobError(err, { url: URL_SIGNED, videoId: "v1" });
    expect(out).toBe(
      "ffmpeg failed (exit code 1): video v1: Server returned 403 Forbidden\nhttps://other.example/x.mp4?[redacted]",
    );
    expect(out).not.toMatch(/X-Amz|Signature|abc123|KEY/);
  });

  it("caps the text at 500 characters and handles a missing URL", () => {
    const out = redactJobError(new Error("e".repeat(2000)), { videoId: "v1" });
    expect(out).toHaveLength(ERROR_MESSAGE_MAX);
    expect(redactJobError("plain", { videoId: "v1" })).toBe("plain");
    expect(redactJobError(new Error(""), { videoId: "v1" })).toBe("Unknown error");
  });
});

describe("jobLog", () => {
  it("writes one line with ids, attempt and timings only", () => {
    lines.length = 0;
    const job = {
      id: "pj1",
      organisationId: "o1",
      matchId: "m1",
      videoId: "v1",
      type: "transcode" as const,
      status: "running" as const,
      bossJobId: "00000000-0000-4000-8000-000000000001",
      attempts: 2,
      maxAttempts: 3,
      queuedAt: new Date("2026-10-26T10:00:00Z"),
      startedAt: new Date("2026-10-26T10:01:00Z"),
      finishedAt: null,
    };
    jobLog("started", job);
    jobLog("failed", job, { error: "ffmpeg failed" });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      level: 30,
      msg: "processing job",
      event: "started",
      processingJobId: "pj1",
      bossJobId: job.bossJobId,
      type: "transcode",
      organisationId: "o1",
      matchId: "m1",
      videoId: "v1",
      attempt: 2,
      maxAttempts: 3,
      queuedAt: "2026-10-26T10:00:00.000Z",
      startedAt: "2026-10-26T10:01:00.000Z",
      finishedAt: null,
    });
    // NFR30: the final failure is logged at error level.
    expect(lines[1]).toMatchObject({ level: 50, event: "failed", error: "ffmpeg failed" });
    const keys = Object.keys(lines[0]!);
    for (const k of ["name", "fileName", "firstName", "lastName", "email", "fixture"]) {
      expect(keys).not.toContain(k);
    }
  });
});
