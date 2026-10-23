"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { setActiveOrganisation } from "@/server/auth/organisations";
import { ALL_ROLES, AuthzError, requireRole } from "@/server/auth/session";

/** Makes another organisation active on this session (AUTH05), then goes to its home. */
export async function switchOrganisation(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(ALL_ROLES);
  const organisationId = z.string().min(1).safeParse(formData.get("organisationId"));
  try {
    if (!organisationId.success) throw new AuthzError(403, "No organisation");
    await setActiveOrganisation(ctx.sessionId, ctx.user.id, organisationId.data);
  } catch (err) {
    if (err instanceof AuthzError) {
      revalidatePath("/organisations");
      return { ok: false, formError: "You can no longer switch to that organisation." };
    }
    throw err;
  }
  revalidatePath("/", "layout");
  redirect("/");
}
