import type { GpuInstanceStatus, ProcessingJobStatus } from "@/generated/prisma/enums";
import type { DestroyReason } from "./instances";
import type { GpuListedInstance } from "./providers/types";

/**
 * The CV watchdog's rules (C08; NFR07): pure, so the tests drive them with a
 * fixed clock. src/worker/cv-watchdog.ts runs them every minute and applies
 * the actions.
 *
 * - idle: a running instance with no heartbeat (the worker sends one a
 *   minute) for 10 minutes;
 * - outlived: a running instance whose job settled, or was taken over by a
 *   later attempt, 30 minutes ago; or one 30 minutes past the longest an
 *   attempt may run;
 * - job_gone: a running instance whose job row is gone (match deleted);
 * - a row stuck in destroying is retried;
 * - a row still requested, never started, after 10 minutes is marked
 *   failed_to_start;
 * - orphan: a labelled provider instance with no live row, two minutes after
 *   it was created.
 */

export const IDLE_LIMIT_MS = 10 * 60 * 1000;
export const OUTLIVED_LIMIT_MS = 30 * 60 * 1000;
export const START_LIMIT_MS = 10 * 60 * 1000;
export const ORPHAN_GRACE_MS = 2 * 60 * 1000;
/** A cv job queued this long without starting is sent again. */
export const RESEND_AFTER_MS = 5 * 60 * 1000;
/** C09: a clips job queued this long without starting is sent again (its send was lost). */
export const CLIPS_RESEND_AFTER_MS = 10 * 60 * 1000;

export type WatchdogInstance = {
  id: string;
  processingJobId: string;
  attempt: number;
  status: GpuInstanceStatus;
  providerInstanceId: string | null;
  requestedAt: Date;
  startedAt: Date | null;
  lastHeartbeatAt: Date | null;
  jobSettledAt: Date | null;
};

export type WatchdogJob = {
  status: ProcessingJobStatus;
  attempts: number;
  finishedAt: Date | null;
  lastAttemptAt: Date | null;
};

export type WatchdogAction =
  | { kind: "destroy"; instanceId: string; reason: DestroyReason }
  | { kind: "failed_to_start"; instanceId: string }
  | { kind: "destroy_orphan"; providerInstanceId: string };

const ago = (now: Date, ms: number) => now.getTime() - ms;

/** When the job this instance served stopped needing it, or null if it still does. */
function settledAt(i: WatchdogInstance, job: WatchdogJob): Date | null {
  if (i.jobSettledAt) return i.jobSettledAt;
  if (job.status === "succeeded" || job.status === "failed") return job.finishedAt ?? i.requestedAt;
  if (job.attempts > i.attempt) return job.lastAttemptAt ?? i.requestedAt;
  return null;
}

export function decideWatchdog(
  instances: WatchdogInstance[],
  jobsById: ReadonlyMap<string, WatchdogJob>,
  listed: GpuListedInstance[] | null,
  now: Date,
  maxJobSeconds: number,
): WatchdogAction[] {
  const actions: WatchdogAction[] = [];
  for (const i of instances) {
    if (i.status === "destroying") {
      actions.push({ kind: "destroy", instanceId: i.id, reason: "outlived" });
      continue;
    }
    if (i.status === "requested") {
      if (!i.providerInstanceId && i.requestedAt.getTime() <= ago(now, START_LIMIT_MS)) {
        actions.push({ kind: "failed_to_start", instanceId: i.id });
      }
      continue;
    }
    if (i.status !== "running") continue;
    const job = jobsById.get(i.processingJobId);
    if (!job) {
      actions.push({ kind: "destroy", instanceId: i.id, reason: "job_gone" });
      continue;
    }
    const lastSign = i.lastHeartbeatAt ?? i.startedAt ?? i.requestedAt;
    if (lastSign.getTime() <= ago(now, IDLE_LIMIT_MS)) {
      actions.push({ kind: "destroy", instanceId: i.id, reason: "idle" });
      continue;
    }
    const settled = settledAt(i, job);
    const start = i.startedAt ?? i.requestedAt;
    const pastMax = start.getTime() + maxJobSeconds * 1000 + OUTLIVED_LIMIT_MS <= now.getTime();
    if ((settled && settled.getTime() <= ago(now, OUTLIVED_LIMIT_MS)) || pastMax) {
      actions.push({ kind: "destroy", instanceId: i.id, reason: "outlived" });
    }
  }
  if (listed) {
    const live = new Set(instances.filter((i) => i.status !== "destroyed").map((i) => i.id));
    for (const l of listed) {
      if (l.instanceId && live.has(l.instanceId)) continue;
      if (l.createdAt.getTime() > ago(now, ORPHAN_GRACE_MS)) continue;
      actions.push({ kind: "destroy_orphan", providerInstanceId: l.providerInstanceId });
    }
  }
  return actions;
}
