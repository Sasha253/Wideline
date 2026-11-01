"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { fieldErrorsFrom, type ActionResult } from "@/lib/action-result";
import { AuthzError, ORG_ADMIN_ROLES, requireRole } from "@/server/auth/session";
import { log } from "@/server/log";
import { updateAutoAcceptThresholds } from "@/server/organisations/settings";

// The review threshold settings (REVIEW10; docs/build/design/C11.md, Surface
// 6). Owners and admins only (Q-070): a coach sees the page read-only, and a
// coach's post is refused here.

const SAVE_FAILED = "We could not save the thresholds. Try again.";
const FORBIDDEN = "Only owners and admins can change review settings.";

export async function saveThresholdsAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let ctx;
  try {
    ctx = await requireRole(ORG_ADMIN_ROLES);
  } catch (err) {
    if (err instanceof AuthzError && err.status === 403) return { ok: false, formError: FORBIDDEN };
    throw err;
  }
  try {
    await updateAutoAcceptThresholds(ctx, {
      goal: String(formData.get("goal") ?? ""),
      shot: String(formData.get("shot") ?? ""),
      touch: String(formData.get("touch") ?? ""),
    });
  } catch (err) {
    if (err instanceof ZodError) return { ok: false, fieldErrors: fieldErrorsFrom(err.issues) };
    if (err instanceof AuthzError) return { ok: false, formError: FORBIDDEN };
    log.error({ err }, "review thresholds save failed");
    return { ok: false, formError: SAVE_FAILED };
  }
  revalidatePath("/settings/review");
  return { ok: true, message: "Thresholds saved.", key: String(Date.now()) };
}
