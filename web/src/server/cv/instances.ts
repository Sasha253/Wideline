import { createHmac, timingSafeEqual } from "node:crypto";
import type { GpuInstanceStatus } from "@/generated/prisma/enums";
import { rawDb } from "../db/raw";
import { log } from "../log";
import type { JobRef } from "../processing/jobs";
import { recordUsage } from "../usage/meter";
import { billedSeconds, costCents } from "./billing";
import { cvConfig } from "./config";
import type { GpuProvider } from "./providers/types";

/**
 * GPU instances (C08; NFR04, NFR07): one GpuInstance row per CV attempt, so a
 * replayed delivery of an attempt finds its instance instead of renting a
 * second one. The row outlives its match (plain columns), so the watchdog and
 * the cost report still see it after a deletion.
 *
 * Cost is recorded once per instance, when it is destroyed: the row's
 * billedSeconds and costCents, ProcessingJob.costCents (the sum over the job's
 * instances, failed attempts included), and one gpu_cost_cents usage row
 * (sourceType "GpuInstance", sourceId the instance id, metadata.matchId), all
 * in one transaction. Raw client, explicit organisationId (ESLint allowlist).
 */

export type InstanceRef = {
  id: string;
  organisationId: string;
  processingJobId: string;
  matchId: string;
  attempt: number;
  provider: string;
  providerInstanceId: string | null;
  status: GpuInstanceStatus;
  requestedAt: Date;
  startedAt: Date | null;
  lastHeartbeatAt: Date | null;
  resultStatus: string | null;
  resultAt: Date | null;
  resultError: string | null;
  resultSha256: string | null;
  jobSettledAt: Date | null;
  centsPerHour: number;
  currency: string;
};

export const INSTANCE_SELECT = {
  id: true,
  organisationId: true,
  processingJobId: true,
  matchId: true,
  attempt: true,
  provider: true,
  providerInstanceId: true,
  status: true,
  requestedAt: true,
  startedAt: true,
  lastHeartbeatAt: true,
  resultStatus: true,
  resultAt: true,
  resultError: true,
  resultSha256: true,
  jobSettledAt: true,
  centsPerHour: true,
  currency: true,
} as const;

/** Why an instance was destroyed, for the row and the log. */
export type DestroyReason =
  "job_done" | "attempt_failed" | "idle" | "outlived" | "orphan" | "job_gone" | "start_failed";

/** The attempt's instance row, created on first call. */
export async function requestInstance(
  job: JobRef,
  attempt: number,
  provider: GpuProvider,
  now = new Date(),
): Promise<InstanceRef> {
  await rawDb.gpuInstance.createMany({
    data: [
      {
        organisationId: job.organisationId,
        processingJobId: job.id,
        matchId: job.matchId,
        attempt,
        provider: provider.name,
        requestedAt: now,
        centsPerHour: provider.billing.centsPerHour,
        currency: provider.billing.currency,
      },
    ],
    skipDuplicates: true,
  });
  return rawDb.gpuInstance.findUniqueOrThrow({
    where: { processingJobId_attempt: { processingJobId: job.id, attempt } },
    select: INSTANCE_SELECT,
  });
}

export async function findInstance(id: string): Promise<InstanceRef | null> {
  return rawDb.gpuInstance.findUnique({ where: { id }, select: INSTANCE_SELECT });
}

/** Records the provider's id once the instance is started. */
export async function markInstanceStarted(
  instance: InstanceRef,
  providerInstanceId: string,
  now = new Date(),
): Promise<InstanceRef> {
  await rawDb.gpuInstance.updateMany({
    where: { id: instance.id, status: "requested" },
    data: { status: "running", providerInstanceId, startedAt: now },
  });
  return { ...instance, status: "running", providerInstanceId, startedAt: now };
}

/** Marks every live instance of a job as serving a settled job, for the watchdog's 30-minute rule. */
export async function markJobSettled(processingJobId: string, now = new Date()): Promise<void> {
  await rawDb.gpuInstance.updateMany({
    where: { processingJobId, jobSettledAt: null },
    data: { jobSettledAt: now },
  });
}

/** The HMAC a CV instance signs its callbacks with: one token per instance and job. */
export function callbackToken(instanceId: string, jobId: string): string {
  return createHmac("sha256", cvConfig().CV_CALLBACK_SECRET)
    .update(`cv:${jobId}:${instanceId}`)
    .digest("hex");
}

/** Constant-time check of a callback token. */
export function verifyCallbackToken(token: string, instanceId: string, jobId: string): boolean {
  const expected = Buffer.from(callbackToken(instanceId, jobId), "utf8");
  const given = Buffer.from(token, "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Destroys an instance and records its cost, once. The row goes to
 * destroying first; if the provider call throws it stays there and the
 * watchdog retries. Returns the cost in cents, or null when another caller
 * had already destroyed it.
 */
export async function destroyInstance(
  instance: InstanceRef,
  reason: DestroyReason,
  provider: GpuProvider,
  now = new Date(),
): Promise<number | null> {
  const { count } = await rawDb.gpuInstance.updateMany({
    where: {
      id: instance.id,
      status: { in: ["requested", "running", "destroying", "failed_to_start"] },
    },
    data: { status: "destroying" },
  });
  if (count === 0) return null;
  if (instance.providerInstanceId) await provider.destroy(instance.providerInstanceId);

  const start = instance.startedAt ?? instance.requestedAt;
  const seconds = instance.providerInstanceId ? billedSeconds(start, now, provider.billing) : 0;
  const cents = costCents(seconds, instance.centsPerHour);
  const done = await rawDb.$transaction(async (tx) => {
    const { count: moved } = await tx.gpuInstance.updateMany({
      where: { id: instance.id, status: "destroying" },
      data: {
        status: "destroyed",
        destroyedAt: now,
        destroyReason: reason,
        billedSeconds: seconds,
        costCents: cents,
      },
    });
    if (moved === 0) return false;
    // COALESCE: the job's first instance starts the sum. The job row may be
    // gone (match deleted); the instance row keeps the cost.
    await tx.$executeRaw`
      UPDATE "ProcessingJob" SET "costCents" = COALESCE("costCents", 0) + ${cents}
      WHERE "id" = ${instance.processingJobId} AND "organisationId" = ${instance.organisationId}`;
    await recordUsage(
      {
        organisationId: instance.organisationId,
        metric: "gpu_cost_cents",
        quantity: cents,
        currency: instance.currency,
        sourceType: "GpuInstance",
        sourceId: instance.id,
        occurredAt: now,
        metadata: {
          matchId: instance.matchId,
          processingJobId: instance.processingJobId,
          provider: instance.provider,
          billedSeconds: seconds,
        },
      },
      tx,
    );
    return true;
  });
  if (!done) return null;
  log.info(
    {
      event: "instance_destroyed",
      gpuInstanceId: instance.id,
      processingJobId: instance.processingJobId,
      organisationId: instance.organisationId,
      matchId: instance.matchId,
      attempt: instance.attempt,
      reason,
      billedSeconds: seconds,
      costCents: cents,
    },
    "gpu instance",
  );
  return cents;
}

/** An instance whose start never reached the provider: nothing to destroy, nothing billed. */
export async function markFailedToStart(instance: InstanceRef, now = new Date()): Promise<void> {
  await rawDb.gpuInstance.updateMany({
    where: { id: instance.id, status: "requested", providerInstanceId: null },
    data: { status: "failed_to_start", destroyedAt: now, destroyReason: "start_failed" },
  });
}
