"use server";

import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { fieldErrorsByPath, UNEXPECTED_ERROR, type ActionResult } from "@/lib/action-result";
import { ACCOUNT_EXISTS, checkEmailMessage, IDENTITY_TAKEN } from "@/lib/scout-fields";
import { sendEmailConfirmation } from "@/server/auth/email-verification";
import { setActiveOrganisation } from "@/server/auth/organisations";
import { getUserContext } from "@/server/auth/session";
import { log } from "@/server/log";
import { SCOUT_NETWORK_ORG_ID } from "@/server/scouts/network";
import { registerScout, ScoutRegistrationError } from "@/server/scouts/registration";

/**
 * Public scout registration (AUTH08, AUTH09, AUTH10). Unauthenticated by
 * design, so it is on the guarded-actions allowlist: a signed-out visitor gets
 * a new account, a signed-in user registers only themselves (the session user,
 * never a form field). A honeypot catches simple bots; IP rate limiting is C19.
 * The ID number is never echoed in the result or logged.
 *
 * Signed out, nothing signs in here: the new account has no password and no
 * session until the mailbox owner opens the confirmation link (see
 * registerScout). The result tells them to check their email.
 */

export async function registerScoutAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const value = (name: string) => String(formData.get(name) ?? "");
  const all = (name: string) => formData.getAll(name).map(String);
  const ctx = await getUserContext();

  try {
    const res = await registerScout({
      input: {
        name: value("name"),
        email: value("email"),
        phone: value("phone"),
        idDocumentType: value("idDocumentType"),
        idNumber: value("idNumber"),
        idCountry: value("idCountry"),
        clubName: all("clubName"),
        playerName: all("playerName"),
        playerClub: all("playerClub"),
        noAffiliations: value("noAffiliations") === "yes",
        acceptTerms: value("acceptTerms") === "yes",
        website: value("website"),
      },
      signedInUser: ctx?.user,
    });

    if (res.createdUser) {
      await sendEmailConfirmation(res.email, "/scout?registered=1");
      return { ok: true, message: checkEmailMessage(res.email) };
    }
    if (ctx) await setActiveOrganisation(ctx.sessionId, ctx.user.id, SCOUT_NETWORK_ORG_ID);
  } catch (err) {
    if (err instanceof ZodError) return { ok: false, fieldErrors: fieldErrorsByPath(err.issues) };
    if (err instanceof ScoutRegistrationError) {
      switch (err.code) {
        // The same result as a real registration, so a bot learns nothing.
        case "spam":
          return {
            ok: true,
            message: ctx ? "Registration received" : checkEmailMessage(value("email").trim()),
          };
        case "identity_taken":
          return { ok: false, fieldErrors: { idNumber: IDENTITY_TAKEN } };
        case "account_exists":
          return { ok: false, fieldErrors: { email: ACCOUNT_EXISTS } };
        case "already_registered":
          redirect("/scout");
      }
    }
    // Safe to log: the raw number never reaches the database or Better Auth,
    // only its hash, so no error below can carry it.
    log.error({ err }, "scout registration failed");
    return { ok: false, formError: UNEXPECTED_ERROR };
  }
  redirect("/scout?registered=1");
}
