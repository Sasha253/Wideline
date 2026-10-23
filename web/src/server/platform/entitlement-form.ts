import "server-only";
import { LIMIT_KEYS, UNLIMITED, type LimitKey } from "@/lib/entitlement-keys";
import { entitlementReasonField } from "./entitlements";

/**
 * Reads the limit form on the flags and limits page (docs/build/design/C03.md,
 * "Field errors"): a whole number for counts, a size in GB for bytes (stored as
 * whole bytes), or the Unlimited box, which wins when both are sent.
 */

export const LIMIT_REQUIRED = "Enter a whole number, or tick Unlimited.";
export const COUNT_INVALID = "Enter a whole number of 0 or more.";
export const COUNT_TOO_BIG = "Use 1,000,000,000 or less.";
export const GB_INVALID = "Enter a size in GB of 0 or more, for example 8.5.";
export const GB_TOO_BIG = "Use 10,000 GB or less.";

const MAX_COUNT = 1_000_000_000;
const MAX_GB = 10_000;
const BYTES_PER_GB = 1_000_000_000;

export type LimitFormResult =
  | { ok: true; value: number | typeof UNLIMITED; reason: string | null }
  | { ok: false; fieldErrors: Record<string, string> };

export function parseLimitForm(key: LimitKey, formData: FormData): LimitFormResult {
  const fieldErrors: Record<string, string> = {};
  const reason = entitlementReasonField.safeParse(String(formData.get("reason") ?? ""));
  if (!reason.success) fieldErrors.reason = reason.error.issues[0]!.message;

  let value: number | typeof UNLIMITED = UNLIMITED;
  if (formData.get("unlimited") !== "yes") {
    const raw = String(formData.get("value") ?? "").trim();
    if (!raw) {
      fieldErrors.value = LIMIT_REQUIRED;
    } else if (LIMIT_KEYS[key].unit === "bytes") {
      const gb = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
      if (Number.isNaN(gb)) fieldErrors.value = GB_INVALID;
      else if (gb > MAX_GB) fieldErrors.value = GB_TOO_BIG;
      else value = Math.round(gb * BYTES_PER_GB);
    } else {
      const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (Number.isNaN(n)) fieldErrors.value = COUNT_INVALID;
      else if (n > MAX_COUNT) fieldErrors.value = COUNT_TOO_BIG;
      else value = n;
    }
  }

  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  return { ok: true, value, reason: reason.success ? reason.data : null };
}
