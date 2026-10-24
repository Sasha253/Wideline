import "server-only";
import { ZodError } from "zod";
import { AuthzError } from "../auth/session";
import { log } from "../log";
import { MatchError, type MatchErrorCode } from "./errors";

// JSON answers for the upload route handlers (src/app/api/matches/). The
// uploader maps each error code to the C06 copy; 5xx answers are retried.

const STATUS: Partial<Record<MatchErrorCode, number>> = {
  not_found: 404,
  invalid: 400,
  upload_type: 415,
  upload_empty: 400,
  upload_too_big: 413,
  upload_exists: 409,
  upload_gone: 410,
  missing_parts: 409,
  no_footage: 404,
};

/** The response for an error thrown by the upload service; unexpected errors are 500. */
export function errorResponse(err: unknown, what: string): Response {
  if (err instanceof AuthzError) {
    return Response.json({ error: "forbidden", message: err.message }, { status: err.status });
  }
  if (err instanceof MatchError) {
    return Response.json(
      { error: err.code, message: err.userMessage, ...err.detail },
      { status: STATUS[err.code] ?? 400 },
    );
  }
  if (err instanceof ZodError) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  log.error({ err }, `${what} failed`);
  return Response.json({ error: "server" }, { status: 500 });
}

/** The request body as JSON, or {} when there is none or it is not JSON. */
export async function jsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
