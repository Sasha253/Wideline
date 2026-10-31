"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { fieldErrorsFrom, UNEXPECTED_ERROR, type ActionResult } from "@/lib/action-result";
import { PROFILE_TERMS_REQUIRED } from "@/lib/scout-fields";
import { sendEmailConfirmation } from "@/server/auth/email-verification";
import { PasswordError, setOwnPassword } from "@/server/auth/password";
import { requireRole, SCOUT_ROLES } from "@/server/auth/session";
import { formatDate } from "@/lib/labels";
import { log } from "@/server/log";
import { coolingOffUntil } from "@/server/scouts/conflicts";
import {
  acceptCurrentTerms,
  addOwnAffiliation,
  getOwnScoutProfile,
  removeOwnAffiliation,
  ScoutProfileError,
  updateOwnPhone,
} from "@/server/scouts/profile";

// Server actions for /scout (AUTH09, AUTH10). Each one calls
// requireRole(SCOUT_ROLES) and then works only on ctx.user.id's own profile;
// no form field names a profile or a user.

const PATH = "/scout";
const NO_PROFILE = "You have no scout profile yet. Register as a scout first.";

function failed(err: unknown, what: string): ActionResult {
  if (err instanceof ScoutProfileError && err.code === "no_profile") {
    return { ok: false, formError: NO_PROFILE };
  }
  log.error({ err }, `${what} failed`);
  return { ok: false, formError: UNEXPECTED_ERROR };
}

export async function updateScoutPhoneAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(SCOUT_ROLES);
  try {
    await updateOwnPhone(ctx.user.id, String(formData.get("phone") ?? ""));
    revalidatePath(PATH);
    return { ok: true, message: "Mobile number saved.", key: randomUUID() };
  } catch (err) {
    if (err instanceof ZodError) return { ok: false, fieldErrors: fieldErrorsFrom(err.issues) };
    return failed(err, "scout phone change");
  }
}

export async function addAffiliationAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(SCOUT_ROLES);
  const type = formData.get("type") === "player" ? "player" : "club";
  const name = String(formData.get("name") ?? "").trim();
  try {
    const row = await addOwnAffiliation(ctx.user.id, {
      type,
      name,
      clubName: String(formData.get("clubName") ?? ""),
    });
    revalidatePath(PATH);
    return { ok: true, message: `Added ${row.name}.`, key: randomUUID() };
  } catch (err) {
    if (err instanceof ZodError) return { ok: false, fieldErrors: fieldErrorsFrom(err.issues) };
    if (err instanceof ScoutProfileError && err.code === "duplicate") {
      return { ok: false, fieldErrors: { name: `${name} is already on your list.` } };
    }
    if (err instanceof ScoutProfileError && err.code === "limit") {
      return {
        ok: false,
        formError: `You can have up to 30 ${type === "club" ? "clubs" : "players"} on your list. Remove one first.`,
      };
    }
    if (err instanceof ScoutProfileError && err.code === "cooling_off_limit") {
      return {
        ok: false,
        formError:
          "You can have up to 30 players, counting players you removed in the last 90 days. You can add another 90 days after a removal.",
      };
    }
    return failed(err, "scout affiliation add");
  }
}

export async function removeAffiliationAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(SCOUT_ROLES);
  try {
    const row = await removeOwnAffiliation(
      ctx.user.id,
      String(formData.get("affiliationId") ?? ""),
    );
    revalidatePath(PATH);
    // Q-006 (C10): a removed entry keeps blocking for the cooling-off period.
    const until = formatDate(coolingOffUntil(new Date()));
    return {
      ok: true,
      message: `Removed ${row.name}. It keeps blocking matches until ${until}.`,
      key: randomUUID(),
    };
  } catch (err) {
    if (err instanceof ScoutProfileError && err.code === "already_removed") {
      revalidatePath(PATH);
      return { ok: false, formError: "That entry was already removed." };
    }
    return failed(err, "scout affiliation removal");
  }
}

export async function acceptReviewerTermsAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(SCOUT_ROLES);
  if (formData.get("acceptTerms") !== "yes") {
    return { ok: false, fieldErrors: { acceptTerms: PROFILE_TERMS_REQUIRED } };
  }
  try {
    await acceptCurrentTerms(ctx.user.id, String(formData.get("termsVersion") ?? ""));
    const profile = await getOwnScoutProfile(ctx.user.id);
    revalidatePath(PATH);
    return {
      ok: true,
      message:
        profile?.status === "approved"
          ? "Terms accepted. You can review matches again."
          : "Terms accepted.",
      key: randomUUID(),
    };
  } catch (err) {
    if (err instanceof ScoutProfileError && err.code === "terms_changed") {
      revalidatePath(PATH);
      return {
        ok: false,
        formError: "The terms changed while you were reading. Read the new version below.",
      };
    }
    return failed(err, "scout terms acceptance");
  }
}

/** Takes no form fields; useFormAction's (prev, formData) are ignored. */
export async function resendEmailConfirmationAction(): Promise<ActionResult> {
  const ctx = await requireRole(SCOUT_ROLES);
  const sent = await sendEmailConfirmation(ctx.user.email);
  if (!sent) {
    return { ok: false, formError: "We could not send the email. Try again in a few minutes." };
  }
  return {
    ok: true,
    message: `We sent a new link to ${ctx.user.email}. It can take a few minutes to arrive.`,
    key: randomUUID(),
  };
}

/**
 * Sets the first password of the signed-in scout (setOwnPassword refuses an
 * unverified email or an existing password). Never replaces a password.
 */
export async function setScoutPasswordAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(SCOUT_ROLES);
  try {
    // No revalidatePath: the section keeps its success banner until the next
    // page load, which no longer shows it.
    await setOwnPassword(ctx.user.id, String(formData.get("password") ?? ""));
    return {
      ok: true,
      message: "Password set. You can now sign in with your email and this password.",
      key: randomUUID(),
    };
  } catch (err) {
    if (err instanceof ZodError) return { ok: false, fieldErrors: fieldErrorsFrom(err.issues) };
    if (err instanceof PasswordError && err.code === "already_set") {
      return { ok: false, formError: "Your account already has a password." };
    }
    if (err instanceof PasswordError && err.code === "unverified") {
      return { ok: false, formError: "Confirm your email first, then set a password." };
    }
    log.error({ err }, "scout password set failed");
    return { ok: false, formError: UNEXPECTED_ERROR };
  }
}
