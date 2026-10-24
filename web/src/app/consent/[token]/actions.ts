"use server";

import { redirect } from "next/navigation";
import {
  guardianDecide,
  GuardianInputError,
  GuardianLinkError,
  guardianWithdraw,
} from "@/server/consent/guardian";
import { log } from "@/server/log";

/**
 * Public: the guardian link token is the capability, so both actions are on
 * the guarded-actions allowlist (tests/unit/server-actions-guarded.test.ts).
 * guardianDecide and guardianWithdraw re-check the link on every call. Results
 * go back to the page by redirect, so the screens work without JavaScript. The
 * typed name is never put in a URL; only the carried yes or no answers, the
 * wording version and an error code are. A form without the current wording
 * version (NFR09: proof the about step was shown) goes back to the about step.
 */

const yesNo = (v: FormDataEntryValue | null) => (v === "yes" || v === "no" ? v : null);

/** Saves the guardian's answer (Surface 1, "you"). */
export async function guardianDecisionAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const base = `/consent/${encodeURIComponent(token)}`;
  const club = yesNo(formData.get("club"));
  const scouts = yesNo(formData.get("scouts"));
  const wording = String(formData.get("wording") ?? "");
  let target = `${base}?step=done`;
  try {
    await guardianDecide(token, {
      wordingVersion: wording,
      club: club ?? "",
      scouts: scouts ?? "",
      guardianName: String(formData.get("guardianName") ?? ""),
      relationship: String(formData.get("relationship") ?? ""),
      confirm: String(formData.get("confirm") ?? ""),
    });
  } catch (err) {
    if (err instanceof GuardianLinkError) {
      target = base;
    } else if (err instanceof GuardianInputError) {
      if (err.code === "wording") {
        target = `${base}?step=about`;
      } else if (err.code === "answers" || !club || (club === "yes" && !scouts)) {
        target = `${base}?${new URLSearchParams({ step: "club", wording, error: "answers" })}`;
      } else {
        const params = new URLSearchParams({ step: "you", wording, club, scouts: scouts ?? "no" });
        params.set("error", err.code);
        target = `${base}?${params}`;
      }
    } else {
      log.error({ err }, "guardian consent decision failed");
      throw err;
    }
  }
  redirect(target);
}

/** Stops sharing (Surface 1, "withdraw"). */
export async function guardianWithdrawAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const base = `/consent/${encodeURIComponent(token)}`;
  let target = `${base}?step=stopped`;
  try {
    await guardianWithdraw(token);
  } catch (err) {
    if (err instanceof GuardianLinkError) {
      target = base;
    } else {
      log.error({ err }, "guardian consent withdrawal failed");
      throw err;
    }
  }
  redirect(target);
}
