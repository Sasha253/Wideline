import { z } from "zod";
import type { GpuInstanceStatus } from "@/generated/prisma/enums";
import { rawDb } from "../db/raw";
import { ERROR_MESSAGE_MAX } from "../processing/jobs";
import { redactProbeError } from "../processing/redact";
import { verifyCallbackToken } from "./instances";

/**
 * The CV worker's callback (C08; CV01): the one machine route with no
 * session, authenticated by the instance's HMAC token (Authorization: Bearer).
 * It records what the worker says (a heartbeat, or the result's outcome) on
 * the GpuInstance row and nothing else; the dispatcher, which polls the row,
 * validates and ingests the result. A 410 tells the worker to stop: its
 * instance or its job is no longer live. A requested instance is live too: a
 * fast worker can call back before provider.start() has returned.
 */

export const CALLBACK_MAX_BYTES = 8 * 1024;

const LIVE: GpuInstanceStatus[] = ["requested", "running"];

const bodySchema = z
  .object({
    instanceId: z.string().min(1).max(64),
    kind: z.enum(["heartbeat", "succeeded", "failed"]),
    resultSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    error: z.string().max(2000).optional(),
  })
  .strict()
  .refine((b) => b.kind !== "succeeded" || b.resultSha256, {
    error: "succeeded needs resultSha256",
  });

export type CallbackResponse = { status: number; body: { ok: boolean; error?: string } };

const reply = (status: number, error?: string): CallbackResponse => ({
  status,
  body: error ? { ok: false, error } : { ok: true },
});

/** Error text from a worker: URLs cut at the query string, capped at 500 characters. */
function cleanError(text: string | undefined): string {
  const redacted = redactProbeError(text ?? "", "", "").trim() || "Worker reported a failure";
  return redacted.length > ERROR_MESSAGE_MAX
    ? `${redacted.slice(0, ERROR_MESSAGE_MAX - 1)}…`
    : redacted;
}

export async function handleCvCallback(
  jobId: string,
  authorization: string | null,
  rawBody: string,
  now = new Date(),
): Promise<CallbackResponse> {
  if (Buffer.byteLength(rawBody, "utf8") > CALLBACK_MAX_BYTES) return reply(413, "too_large");
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return reply(400, "invalid_json");
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return reply(400, "invalid_body");
  const body = parsed.data;

  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token || !verifyCallbackToken(token, body.instanceId, jobId)) {
    return reply(401, "unauthorised");
  }

  const instance = await rawDb.gpuInstance.findUnique({
    where: { id: body.instanceId },
    select: { id: true, processingJobId: true, organisationId: true, status: true },
  });
  if (!instance || instance.processingJobId !== jobId) return reply(401, "unauthorised");
  const job = await rawDb.processingJob.findFirst({
    where: { id: jobId, organisationId: instance.organisationId },
    select: { status: true },
  });
  if (!LIVE.includes(instance.status) || job?.status !== "running") return reply(410, "gone");

  if (body.kind === "heartbeat") {
    await rawDb.gpuInstance.updateMany({
      where: { id: instance.id, status: { in: LIVE } },
      data: { lastHeartbeatAt: now },
    });
    return reply(202);
  }
  // Only the first outcome counts: a retried callback changes nothing.
  await rawDb.gpuInstance.updateMany({
    where: { id: instance.id, status: { in: LIVE }, resultStatus: null },
    data: {
      resultStatus: body.kind,
      resultAt: now,
      lastHeartbeatAt: now,
      resultSha256: body.kind === "succeeded" ? body.resultSha256 : null,
      resultError: body.kind === "failed" ? cleanError(body.error) : null,
    },
  });
  return reply(202);
}
