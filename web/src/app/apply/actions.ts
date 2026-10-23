"use server";

import { ZodError } from "zod";
import { fieldErrorsFrom, UNEXPECTED_ERROR, type ActionResult } from "@/lib/action-result";
import { getUserContext } from "@/server/auth/session";
import { log } from "@/server/log";
import { ApplicationError, submitOrganisationApplication } from "@/server/platform/organisations";

/**
 * Public "Join the pilot" form (ADMIN01). Unauthenticated by design, so it is
 * on the guarded-actions allowlist. A honeypot field catches simple bots; a
 * caught bot sees the same thanks and nothing is created. IP rate limiting is
 * C19 hardening.
 */
export async function applyForOrganisation(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const value = (name: string) => String(formData.get(name) ?? "");
  const thanks: ActionResult = { ok: true, message: "Application sent" };
  try {
    const ctx = await getUserContext();
    await submitOrganisationApplication(
      {
        name: value("name"),
        type: value("type") as "club",
        country: value("country") || "ZA",
        region: value("region"),
        applicantName: value("applicantName"),
        applicantEmail: value("applicantEmail"),
        website: value("website"),
      },
      ctx?.user.id ?? null,
    );
    return thanks;
  } catch (err) {
    if (err instanceof ZodError) return { ok: false, fieldErrors: fieldErrorsFrom(err.issues) };
    if (err instanceof ApplicationError && err.code === "spam") return thanks;
    if (err instanceof ApplicationError && err.code === "duplicate") {
      return {
        ok: false,
        formError:
          "We already have an application from this email. We will email you when it is decided.",
      };
    }
    log.error({ err }, "organisation application failed");
    return { ok: false, formError: UNEXPECTED_ERROR };
  }
}
