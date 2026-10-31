"use server";

import { APIError } from "better-auth/api";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { UNEXPECTED_ERROR, type ActionResult } from "@/lib/action-result";
import { auth } from "@/server/auth/auth";
import { getUserContext, PLATFORM_ROLES, requireRole } from "@/server/auth/session";
import { log } from "@/server/log";

// "Log in as" (src/server/auth/impersonation.ts). Starting needs a platform
// admin; the plugin checks again. Stopping needs only an impersonation session.

export async function impersonateAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(PLATFORM_ROLES);
  const userId = z.string().min(1).safeParse(formData.get("userId"));
  if (!userId.success) return { ok: false, formError: UNEXPECTED_ERROR };
  try {
    await auth().api.startImpersonation({
      body: { userId: userId.data },
      headers: await headers(),
    });
  } catch (err) {
    if (err instanceof APIError && err.statusCode < 500) {
      revalidatePath("/admin/users");
      return { ok: false, formError: err.message };
    }
    log.error({ err }, "impersonation failed");
    return { ok: false, formError: UNEXPECTED_ERROR };
  }
  revalidatePath("/", "layout");
  redirect("/");
}

export async function stopImpersonatingAction(): Promise<void> {
  const ctx = await getUserContext();
  if (!ctx?.impersonator) redirect("/");
  const { restored } = await auth().api.stopImpersonation({ headers: await headers() });
  revalidatePath("/", "layout");
  redirect(restored ? "/admin/users" : "/login");
}
