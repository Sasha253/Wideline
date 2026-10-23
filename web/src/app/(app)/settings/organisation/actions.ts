"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { fieldErrorsFrom, UNEXPECTED_ERROR, type ActionResult } from "@/lib/action-result";
import { log } from "@/server/log";
import { ORG_ADMIN_ROLES, requireRole } from "@/server/auth/session";
import {
  SettingsError,
  TYPE_ERROR,
  updateOrganisationSettings,
} from "@/server/organisations/settings";

export async function saveOrganisationSettings(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(ORG_ADMIN_ROLES);
  const type = formData.get("type");
  try {
    await updateOrganisationSettings(ctx, {
      name: String(formData.get("name") ?? ""),
      type: type ? (String(type) as "club") : undefined,
      country: String(formData.get("country") ?? ""),
      region: String(formData.get("region") ?? ""),
    });
  } catch (err) {
    if (err instanceof ZodError) {
      const fieldErrors = fieldErrorsFrom(err.issues);
      if (fieldErrors.type) return { ok: false, formError: TYPE_ERROR };
      return { ok: false, fieldErrors };
    }
    if (err instanceof SettingsError) return { ok: false, formError: TYPE_ERROR };
    log.error({ err }, "organisation settings save failed");
    return { ok: false, formError: UNEXPECTED_ERROR };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Settings saved.", key: String(Date.now()) };
}
