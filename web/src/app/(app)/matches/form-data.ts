import "server-only";
import { ZodError } from "zod";
import { fieldErrorsFrom, UNEXPECTED_ERROR, type ActionResult } from "@/lib/action-result";
import { log } from "@/server/log";
import { MATCH_GONE, MatchError } from "@/server/matches/errors";
import type { MatchInput } from "@/server/matches/fields";

// Shared by the match server actions: form fields in, ActionResult out.

export function matchInput(formData: FormData): MatchInput {
  const text = (name: string) => String(formData.get(name) ?? "");
  return {
    homeTeamId: text("homeTeamId"),
    awayTeamId: text("awayTeamId"),
    playedAt: text("playedAt"),
    venue: text("venue"),
    competition: text("competition"),
    halfLengthMinutes: text("halfLengthMinutes"),
  };
}

/** Maps a service error to field errors or a form error; anything unexpected is logged. */
export function matchActionError(err: unknown, what: string): ActionResult {
  if (err instanceof ZodError) return { ok: false, fieldErrors: fieldErrorsFrom(err.issues) };
  if (err instanceof MatchError) {
    if (err.code === "not_found") return { ok: false, formError: MATCH_GONE };
    if (err.fieldErrors) {
      return { ok: false, fieldErrors: err.fieldErrors, formError: err.userMessage };
    }
    if (err.field && err.userMessage) {
      return { ok: false, fieldErrors: { [err.field]: err.userMessage } };
    }
    if (err.userMessage) return { ok: false, formError: err.userMessage };
  }
  log.error({ err }, `${what} failed`);
  return { ok: false, formError: UNEXPECTED_ERROR };
}
