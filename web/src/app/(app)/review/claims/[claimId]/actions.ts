"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z, ZodError } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { formatVideoTime } from "@/lib/labels";
import type { WorkspacePatch } from "@/lib/review-workspace";
import { requireReviewer, type ReviewerContext } from "@/server/auth/reviewer";
import { log } from "@/server/log";
import { confirmEvent, correctEvent, reassignEvent, rejectEvent } from "@/server/review/decisions";
import {
  IMPERSONATION_REVIEW_REFUSED,
  REVIEW_WRITE_FAILED,
  ReviewError,
  reviewErrorCopy,
  SUBMIT_FAILED,
  type ReviewErrorCode,
} from "@/server/review/errors";
import { favouriteReviewClip, unfavouriteReviewClip } from "@/server/review/favourites";
import { addMissedEvent, type MissedResult } from "@/server/review/missed";
import { claimScope, type ClaimScope } from "@/server/review/scope";
import { submitReview } from "@/server/review/submit";
import { relinkTrack, swapTeamSides, type RelinkResult } from "@/server/review/tracks";

// Server actions for the review workspace (REVIEW03 to REVIEW09, PROF08;
// docs/build/design/C11.md). Each one calls requireReviewer() and claimScope()
// first, parses its input, and calls the claim-checked write in
// src/server/review/, which locks and re-checks the claim and refuses a "Log
// in as" session. The client gets the changed rows (typed, for its optimistic
// state) or a refusal with its copy. A claim that has ended redirects to its
// page, which says why (the C10 Release pattern).

/** A refusal: the code, its copy, and the field it belongs to when it is a field error. */
export type ReviewRefusal = {
  ok: false;
  code: ReviewErrorCode | "failed";
  message: string;
  field?: "player" | "time";
};

export type ReviewWriteResult<T = WorkspacePatch> = { ok: true; result: T } | ReviewRefusal;

const id = z.string().min(1).max(64);
const side = z.enum(["home", "away"]);
const type = z.enum(["goal", "shot", "touch"]);

const correctSchema = z.object({
  eventId: id,
  type,
  onTarget: z.boolean().nullable(),
  side,
  entryId: id.nullable(),
});
const missedSchema = z.object({
  timestampMs: z.number().int(),
  type,
  onTarget: z.boolean().nullable(),
  side,
  entryId: id.nullable(),
});

function ended(claimId: string): never {
  revalidatePath("/review", "layout");
  redirect(`/review/claims/${encodeURIComponent(claimId)}`);
}

/** The claim's scope, or the redirect to its ended page. */
async function scopeOrEnded(ctx: ReviewerContext, claimId: unknown): Promise<ClaimScope> {
  const cid = String(claimId);
  const scope = await claimScope(ctx, cid);
  if (!scope) ended(cid);
  return scope;
}

async function videoLength(scope: ClaimScope): Promise<string> {
  const v = await scope.db.video.findFirst({ select: { durationSec: true } });
  return formatVideoTime(Math.round((v?.durationSec ?? 0) * 1000), 0);
}

/** Runs one write, mapping refusals to copy. claim_ended redirects (outside the try). */
async function write<T>(
  scope: ClaimScope,
  label: string,
  fn: () => Promise<T>,
): Promise<ReviewWriteResult<T>> {
  let outcome: ReviewWriteResult<T> | "ended";
  try {
    outcome = { ok: true, result: await fn() };
  } catch (err) {
    if (err instanceof ReviewError) {
      if (err.code === "claim_ended") {
        outcome = "ended";
      } else if (err.code === "impersonation_refused") {
        outcome = { ok: false, code: err.code, message: IMPERSONATION_REVIEW_REFUSED };
      } else if (err.code === "out_of_range") {
        outcome = {
          ok: false,
          code: err.code,
          field: "time",
          message: `Enter a time between 0:00 and ${await videoLength(scope)}.`,
        };
      } else {
        const field =
          err.code === "not_attributable" || err.code === "not_in_lineup" ? "player" : undefined;
        outcome = { ok: false, code: err.code, message: reviewErrorCopy(err), field };
      }
    } else if (err instanceof ZodError) {
      outcome = { ok: false, code: "failed", message: REVIEW_WRITE_FAILED };
    } else {
      log.error({ err, claimId: scope.claim.id }, `review ${label} failed`);
      outcome = { ok: false, code: "failed", message: REVIEW_WRITE_FAILED };
    }
  }
  if (outcome === "ended") ended(scope.claim.id);
  return outcome;
}

export async function confirmEventAction(
  claimId: string,
  eventId: string,
): Promise<ReviewWriteResult> {
  const ctx = await requireReviewer();
  const scope = await scopeOrEnded(ctx, claimId);
  return write(scope, "confirm", () => confirmEvent(ctx, scope, id.parse(eventId)));
}

export async function rejectEventAction(
  claimId: string,
  eventId: string,
): Promise<ReviewWriteResult> {
  const ctx = await requireReviewer();
  const scope = await scopeOrEnded(ctx, claimId);
  return write(scope, "reject", () => rejectEvent(ctx, scope, id.parse(eventId)));
}

/** Edit event (Surface 2): type, on target, side and player in one transaction. */
export async function editEventAction(
  claimId: string,
  input: z.input<typeof correctSchema>,
): Promise<ReviewWriteResult> {
  const ctx = await requireReviewer();
  const scope = await scopeOrEnded(ctx, claimId);
  return write(scope, "edit", () => correctEvent(ctx, scope, correctSchema.parse(input)));
}

export async function reassignEventAction(
  claimId: string,
  input: { eventId: string; entryId: string | null },
): Promise<ReviewWriteResult> {
  const ctx = await requireReviewer();
  const scope = await scopeOrEnded(ctx, claimId);
  const parsed = z.object({ eventId: id, entryId: id.nullable() });
  return write(scope, "reassign", () => reassignEvent(ctx, scope, parsed.parse(input)));
}

export async function relinkTrackAction(
  claimId: string,
  input: { trackId: string; entryId: string | null },
): Promise<ReviewWriteResult<RelinkResult>> {
  const ctx = await requireReviewer();
  const scope = await scopeOrEnded(ctx, claimId);
  const parsed = z.object({ trackId: id, entryId: id.nullable() });
  return write(scope, "relink", () => relinkTrack(ctx, scope, parsed.parse(input)));
}

export async function addMissedEventAction(
  claimId: string,
  input: z.input<typeof missedSchema>,
): Promise<ReviewWriteResult<MissedResult>> {
  const ctx = await requireReviewer();
  const scope = await scopeOrEnded(ctx, claimId);
  return write(scope, "add", () => addMissedEvent(ctx, scope, missedSchema.parse(input)));
}

export async function favouriteClipAction(
  claimId: string,
  clipId: string,
): Promise<ReviewWriteResult<{ favourited: boolean }>> {
  const ctx = await requireReviewer();
  const scope = await scopeOrEnded(ctx, claimId);
  return write(scope, "favourite", () => favouriteReviewClip(ctx, scope, id.parse(clipId)));
}

export async function unfavouriteClipAction(
  claimId: string,
  clipId: string,
): Promise<ReviewWriteResult<{ favourited: boolean }>> {
  const ctx = await requireReviewer();
  const scope = await scopeOrEnded(ctx, claimId);
  return write(scope, "unfavourite", () => unfavouriteReviewClip(ctx, scope, id.parse(clipId)));
}

/** Swap home and away (a ConfirmDialog form). The page reloads its data after it. */
export async function swapTeamsAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireReviewer();
  const scope = await scopeOrEnded(ctx, formData.get("claimId"));
  const r = await write(scope, "swap", () => swapTeamSides(ctx, scope));
  if (!r.ok) return { ok: false, formError: r.message };
  const n = r.result.unlinked;
  revalidatePath(`/review/claims/${scope.claim.id}`);
  return {
    ok: true,
    key: String(Date.now()),
    message:
      n === 0
        ? "Home and away swapped."
        : `Home and away swapped. ${n === 1 ? "1 track link was" : `${n} track links were`} removed.`,
  };
}

/** Mark as reviewed (Surface 5, a ConfirmDialog form). Success shows the ended claim. */
export async function submitReviewAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireReviewer();
  const scope = await scopeOrEnded(ctx, formData.get("claimId"));
  const r = await write(scope, "submit", () => submitReview(ctx, scope));
  if (!r.ok) {
    return { ok: false, formError: r.code === "failed" ? SUBMIT_FAILED : r.message };
  }
  revalidatePath("/review", "layout");
  redirect(`/review/claims/${encodeURIComponent(scope.claim.id)}?done=submitted`);
}
