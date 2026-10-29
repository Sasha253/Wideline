import { CALLBACK_MAX_BYTES, handleCvCallback } from "@/server/cv/callback";

// C08 (CV01): the CV worker's callback. No session: the instance's HMAC token
// is the credential, checked in handleCvCallback (src/server/cv/callback.ts).
// It only records the worker's report; the dispatcher ingests the result.

/** The body as text, or null once it passes the cap (read no further). */
async function readCapped(request: Request, max: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const body = await readCapped(request, CALLBACK_MAX_BYTES);
  const res =
    body === null
      ? { status: 413, body: { ok: false, error: "too_large" } }
      : await handleCvCallback(jobId, request.headers.get("authorization"), body);
  return Response.json(res.body, { status: res.status, headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
