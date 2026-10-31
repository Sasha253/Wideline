"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { requireReviewer } from "@/server/auth/reviewer";
import { log } from "@/server/log";
import { claimMatch, releaseClaim } from "@/server/review/claims";
import {
  CLAIM_FAILED,
  DECLARATION_REQUIRED,
  RELEASE_FAILED,
  ReviewError,
  reviewErrorCopy,
  type ReviewErrorCode,
} from "@/server/review/errors";

// Server actions for the review queue and claims (REVIEW01, REVIEW02;
// docs/build/design/C10.md, Surfaces 2 and 3). Each one calls
// requireReviewer() first and trusts nothing from the client beyond the ids
// and the declaration checkbox: claimMatch() and releaseClaim() check the
// scout, the match, the conflicts and the limit again on the server.

/** A refusal with its code, so the claim form can pick what replaces it. */
export type ReviewActionResult = {
  ok: false;
  code: ReviewErrorCode | "failed";
  formError?: string;
  fieldErrors?: Record<string, string>;
} | null;

/**
 * Claims the match for 48 hours. Bound to the match id by the claim page; the
 * form posts only the declaration. Success redirects to the claimed page.
 */
export async function claimMatchAction(
  matchId: string,
  _prev: ReviewActionResult,
  formData: FormData,
): Promise<ReviewActionResult> {
  const ctx = await requireReviewer();
  const declaration = formData.get("declaration") === "yes";
  let claimId: string;
  try {
    ({ claimId } = await claimMatch(ctx, String(matchId), { declaration }));
  } catch (err) {
    if (err instanceof ReviewError) {
      if (err.code === "declaration_required") {
        return {
          ok: false,
          code: err.code,
          fieldErrors: { declaration: DECLARATION_REQUIRED },
        };
      }
      return { ok: false, code: err.code, formError: reviewErrorCopy(err) };
    }
    log.error({ err, matchId }, "review claim failed");
    return { ok: false, code: "failed", formError: CLAIM_FAILED };
  }
  revalidatePath("/review", "layout");
  redirect(`/review/claims/${encodeURIComponent(claimId)}?done=claimed`);
}

/**
 * Releases the caller's own claim (reason scout). A claim that has already
 * ended goes back to its page, which says why; other errors stay in the dialog.
 */
export async function releaseClaimAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireReviewer();
  const claimId = String(formData.get("claimId") ?? "");
  try {
    await releaseClaim(ctx, claimId);
  } catch (err) {
    if (err instanceof ReviewError && err.code === "claim_ended") {
      revalidatePath("/review", "layout");
      redirect(`/review/claims/${encodeURIComponent(claimId)}`);
    }
    if (err instanceof ReviewError) return { ok: false, formError: reviewErrorCopy(err) };
    log.error({ err, claimId }, "review release failed");
    return { ok: false, formError: RELEASE_FAILED };
  }
  revalidatePath("/review", "layout");
  redirect("/review?done=released");
}
