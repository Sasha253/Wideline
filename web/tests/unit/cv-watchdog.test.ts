import { describe, expect, it } from "vitest";
import { decideWatchdog, type WatchdogInstance, type WatchdogJob } from "@/server/cv/watchdog";

// C08 acceptance (NFR07), with a fake clock: an instance idle for 10 minutes,
// or that has outlived its job by 30 minutes, is destroyed; nothing earlier.
// Also: rows stuck in destroying are retried, a start that never happened is
// marked failed_to_start, and labelled provider instances with no live row
// are destroyed as orphans.

const MIN = 60_000;
const now = new Date("2026-10-28T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const MAX_JOB_SECONDS = 4 * 3600;

function instance(over: Partial<WatchdogInstance> = {}): WatchdogInstance {
  return {
    id: "inst_1",
    processingJobId: "job_1",
    attempt: 1,
    status: "running",
    providerInstanceId: "c1",
    requestedAt: ago(20 * MIN),
    startedAt: ago(20 * MIN),
    lastHeartbeatAt: ago(1 * MIN),
    jobSettledAt: null,
    ...over,
  };
}

function job(over: Partial<WatchdogJob> = {}): WatchdogJob {
  return {
    status: "running",
    attempts: 1,
    finishedAt: null,
    lastAttemptAt: ago(20 * MIN),
    ...over,
  };
}

const decide = (i: WatchdogInstance, j: WatchdogJob | null = job()) =>
  decideWatchdog([i], new Map(j ? [[i.processingJobId, j]] : []), null, now, MAX_JOB_SECONDS);

describe("idle (10 minutes without a heartbeat)", () => {
  it("keeps an instance quiet for 9:59", () => {
    expect(decide(instance({ lastHeartbeatAt: ago(10 * MIN - 1000) }))).toEqual([]);
  });

  it("destroys it at 10:00", () => {
    expect(decide(instance({ lastHeartbeatAt: ago(10 * MIN) }))).toEqual([
      { kind: "destroy", instanceId: "inst_1", reason: "idle" },
    ]);
  });

  it("counts from the start when no heartbeat ever came", () => {
    const i = instance({ lastHeartbeatAt: null, startedAt: ago(11 * MIN) });
    expect(decide(i)).toEqual([{ kind: "destroy", instanceId: "inst_1", reason: "idle" }]);
  });
});

describe("outlived (30 minutes past its job)", () => {
  it("keeps a heartbeating instance whose job settled 29:59 ago", () => {
    const settled = job({ status: "succeeded", finishedAt: ago(30 * MIN - 1000) });
    expect(decide(instance(), settled)).toEqual([]);
  });

  it("destroys it at 30:00", () => {
    const settled = job({ status: "failed", finishedAt: ago(30 * MIN) });
    expect(decide(instance(), settled)).toEqual([
      { kind: "destroy", instanceId: "inst_1", reason: "outlived" },
    ]);
  });

  it("uses the instance's own settled time first", () => {
    expect(decide(instance({ jobSettledAt: ago(31 * MIN) }))).toEqual([
      { kind: "destroy", instanceId: "inst_1", reason: "outlived" },
    ]);
  });

  it("treats a later attempt as the job moving on", () => {
    const later = job({ attempts: 2, lastAttemptAt: ago(30 * MIN) });
    expect(decide(instance(), later)).toEqual([
      { kind: "destroy", instanceId: "inst_1", reason: "outlived" },
    ]);
    expect(decide(instance(), job({ attempts: 2, lastAttemptAt: ago(5 * MIN) }))).toEqual([]);
  });

  it("destroys a running job's instance 30 minutes past the longest attempt", () => {
    const old = instance({ startedAt: ago(MAX_JOB_SECONDS * 1000 + 30 * MIN) });
    expect(decide(old)).toEqual([{ kind: "destroy", instanceId: "inst_1", reason: "outlived" }]);
    const younger = instance({ startedAt: ago(MAX_JOB_SECONDS * 1000 + 29 * MIN) });
    expect(decide(younger)).toEqual([]);
  });
});

describe("other rows", () => {
  it("destroys an instance whose job row is gone (match deleted)", () => {
    expect(decide(instance(), null)).toEqual([
      { kind: "destroy", instanceId: "inst_1", reason: "job_gone" },
    ]);
  });

  it("retries a row stuck in destroying", () => {
    expect(decide(instance({ status: "destroying" }))).toEqual([
      { kind: "destroy", instanceId: "inst_1", reason: "outlived" },
    ]);
  });

  it("marks a start that never reached the provider after 10 minutes", () => {
    const pending = { status: "requested" as const, providerInstanceId: null, startedAt: null };
    expect(decide(instance({ ...pending, requestedAt: ago(9 * MIN) }))).toEqual([]);
    expect(decide(instance({ ...pending, requestedAt: ago(10 * MIN) }))).toEqual([
      { kind: "failed_to_start", instanceId: "inst_1" },
    ]);
  });
});

describe("orphans", () => {
  const listed = (instanceId: string | null, ageMs: number) => ({
    providerInstanceId: `c-${instanceId}`,
    instanceId,
    createdAt: ago(ageMs),
  });

  it("destroys labelled instances with no live row, after a 2-minute grace", () => {
    const actions = decideWatchdog(
      [instance()],
      new Map([["job_1", job()]]),
      [
        listed("inst_1", 20 * MIN),
        listed("inst_gone", 5 * MIN),
        listed(null, 5 * MIN),
        listed("new", MIN),
      ],
      now,
      MAX_JOB_SECONDS,
    );
    expect(actions).toEqual([
      { kind: "destroy_orphan", providerInstanceId: "c-inst_gone" },
      { kind: "destroy_orphan", providerInstanceId: "c-null" },
    ]);
  });
});
