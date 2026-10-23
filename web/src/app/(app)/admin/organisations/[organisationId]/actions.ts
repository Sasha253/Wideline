"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { fieldErrorsFrom, UNEXPECTED_ERROR, type ActionResult } from "@/lib/action-result";
import {
  FEATURE_KEYS,
  isFeatureKey,
  isLimitKey,
  LIMIT_KEYS,
  type LimitKey,
} from "@/lib/entitlement-keys";
import { limitText } from "@/lib/labels";
import { PLATFORM_ROLES, requireRole } from "@/server/auth/session";
import { log } from "@/server/log";
import {
  clearLimitOverride,
  EntitlementAdminError,
  entitlementReasonField,
  setFeatureFlag,
  setLimitOverride,
  type ChangeResult,
} from "@/server/platform/entitlements";
import { parseLimitForm } from "@/server/platform/entitlement-form";

// Server actions for /admin/organisations/[organisationId], flags and limits
// (ADMIN04, BILL01; docs/build/design/C03.md). Platform admins only.

const NOT_FOUND = "This organisation no longer exists.";
const UNKNOWN_KEY = "This setting no longer exists. Reload the page.";

function revalidate(organisationId: string) {
  revalidatePath(`/admin/organisations/${organisationId}`);
  revalidatePath("/admin/organisations");
}

function changeError(err: unknown): ActionResult {
  if (err instanceof EntitlementAdminError) {
    return { ok: false, formError: err.code === "not_found" ? NOT_FOUND : UNKNOWN_KEY };
  }
  if (err instanceof ZodError) return { ok: false, fieldErrors: fieldErrorsFrom(err.issues) };
  log.error({ err }, "entitlement change failed");
  return { ok: false, formError: UNEXPECTED_ERROR };
}

const onOff = (on: boolean) => (on ? "On" : "Off");
const planPhrase = (planName: string | null) =>
  planName ? `the ${planName} plan` : "the built-in default";

/** Reason as a field error, before anything is written. */
function reasonError(formData: FormData): Record<string, string> | null {
  const parsed = entitlementReasonField.safeParse(String(formData.get("reason") ?? ""));
  return parsed.success ? null : { reason: parsed.error.issues[0]!.message };
}

export async function setFeatureFlagAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(PLATFORM_ROLES);
  const organisationId = String(formData.get("organisationId") ?? "");
  const key = String(formData.get("key") ?? "");
  const state = String(formData.get("state") ?? "");
  if (!isFeatureKey(key) || !["on", "off", "default"].includes(state)) {
    return { ok: false, formError: UNKNOWN_KEY };
  }
  const reasonErrors = reasonError(formData);
  if (reasonErrors) return { ok: false, fieldErrors: reasonErrors };
  const label = FEATURE_KEYS[key].label;

  let res: ChangeResult;
  try {
    res = await setFeatureFlag(
      ctx,
      organisationId,
      key,
      state as "on" | "off" | "default",
      String(formData.get("reason") ?? ""),
    );
  } catch (err) {
    return changeError(err);
  }
  revalidate(organisationId);
  const on = res.entitlement.value === true;
  if (!res.changed) {
    const was = state === "default" ? "the plan default" : onOff(on);
    return { ok: true, message: `Nothing changed. ${label} was already ${was}.` };
  }
  if (state === "default") {
    return {
      ok: true,
      message: `${label} follows ${planPhrase(res.planName)} again: ${onOff(on)}.`,
    };
  }
  return { ok: true, message: `${label} is ${on ? "on" : "off"} for ${res.organisationName}.` };
}

export async function setLimitOverrideAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(PLATFORM_ROLES);
  const organisationId = String(formData.get("organisationId") ?? "");
  const key = String(formData.get("key") ?? "");
  if (!isLimitKey(key)) return { ok: false, formError: UNKNOWN_KEY };
  const parsed = parseLimitForm(key, formData);
  if (!parsed.ok) return { ok: false, fieldErrors: parsed.fieldErrors };
  const label = LIMIT_KEYS[key].label;

  let res: ChangeResult;
  try {
    res = await setLimitOverride(ctx, organisationId, key, parsed.value, parsed.reason);
  } catch (err) {
    return changeError(err);
  }
  revalidate(organisationId);
  const text = effectiveText(key, res);
  if (!res.changed) return { ok: true, message: `Nothing changed. ${label} was already ${text}.` };
  return { ok: true, message: `${label} is now ${text} for ${res.organisationName}.` };
}

export async function clearLimitOverrideAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(PLATFORM_ROLES);
  const organisationId = String(formData.get("organisationId") ?? "");
  const key = String(formData.get("key") ?? "");
  if (!isLimitKey(key)) return { ok: false, formError: UNKNOWN_KEY };
  const reasonErrors = reasonError(formData);
  if (reasonErrors) return { ok: false, fieldErrors: reasonErrors };
  const label = LIMIT_KEYS[key].label;

  let res: ChangeResult;
  try {
    res = await clearLimitOverride(ctx, organisationId, key, String(formData.get("reason") ?? ""));
  } catch (err) {
    return changeError(err);
  }
  revalidate(organisationId);
  if (!res.changed) {
    return { ok: true, message: `Nothing changed. ${label} was already the plan default.` };
  }
  return {
    ok: true,
    message: `${label} follows ${planPhrase(res.planName)} again: ${effectiveText(key, res)}.`,
  };
}

/** The effective limit as running text: "250 matches", "unlimited", "8.59 GB". */
function effectiveText(key: LimitKey, res: ChangeResult): string {
  const text = limitText(key, res.entitlement.value as number);
  return text === "Unlimited" ? "unlimited" : text;
}
