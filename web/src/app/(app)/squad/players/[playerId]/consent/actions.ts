"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { fieldErrorsFrom, UNEXPECTED_ERROR, type ActionResult } from "@/lib/action-result";
import {
  ALREADY_WITHDRAWN,
  CONSENT_NOT_SAVED,
  CONSENT_NOT_WITHDRAWN,
  CONSENT_PLAYER_GONE,
  LINK_NOT_CREATED,
} from "@/lib/consent-rules";
import { formatDate } from "@/lib/labels";
import { CONSENT_ADMIN_ROLES, requireRole } from "@/server/auth/session";
import { ConsentError } from "@/server/consent/errors";
import { recordConsent, withdrawConsent } from "@/server/consent/records";
import { createConsentRequest, revokeConsentRequest } from "@/server/consent/requests";
import { log } from "@/server/log";
import { requireSquadOrg } from "@/server/squad/access";

// Server actions for consent (CONS01 to CONS03; docs/build/design/C05.md,
// Surfaces 2 and 4). Owners and admins only (CONSENT_ADMIN_ROLES). Logs carry
// the error only: never a guardian's or a player's name (the err serializer
// strips Prisma messages).

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "");

/** A ConsentError as a form result: a field error, or the copy for its code. */
function consentError(err: ConsentError, fallback: string): ActionResult {
  if (err.field && err.userMessage)
    return { ok: false, fieldErrors: { [err.field]: err.userMessage } };
  if (err.code === "not_found" || err.code === "placeholder") {
    return { ok: false, formError: CONSENT_PLAYER_GONE };
  }
  return { ok: false, formError: err.userMessage ?? fallback };
}

/** Records a decision (Surface 2). Success goes back to the player page with ?done=consent. */
export async function recordConsentAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = requireSquadOrg(await requireRole(CONSENT_ADMIN_ROLES));
  const playerId = text(formData, "playerId");
  try {
    await recordConsent(ctx, playerId, {
      grantedBy: text(formData, "grantedBy"),
      relationship: text(formData, "relationship"),
      method: text(formData, "method"),
      grantedAt: text(formData, "grantedAt"),
      clubStats: text(formData, "clubStats"),
      scoutVisible: text(formData, "scoutVisible"),
      seenWording: text(formData, "seenWording"),
    });
  } catch (err) {
    if (err instanceof ZodError) return { ok: false, fieldErrors: fieldErrorsFrom(err.issues) };
    if (err instanceof ConsentError) return consentError(err, CONSENT_NOT_SAVED);
    log.error({ err }, "consent record failed");
    return { ok: false, formError: CONSENT_NOT_SAVED };
  }
  revalidatePath("/squad", "layout");
  redirect(`/squad/players/${playerId}?done=consent`);
}

/** Withdraws a grant (Surface 4, the withdraw dialog). */
export async function withdrawConsentAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = requireSquadOrg(await requireRole(CONSENT_ADMIN_ROLES));
  const playerId = text(formData, "playerId");
  let firstName: string;
  try {
    ({ firstName } = await withdrawConsent(ctx, playerId, {
      requestedBy: text(formData, "requestedBy"),
      relationship: text(formData, "relationship"),
      method: text(formData, "method"),
    }));
  } catch (err) {
    if (err instanceof ZodError) return { ok: false, fieldErrors: fieldErrorsFrom(err.issues) };
    if (err instanceof ConsentError) {
      if (err.code === "not_granted") return { ok: false, formError: ALREADY_WITHDRAWN };
      return consentError(err, CONSENT_NOT_WITHDRAWN);
    }
    log.error({ err }, "consent withdraw failed");
    return { ok: false, formError: CONSENT_NOT_WITHDRAWN };
  }
  revalidatePath("/squad", "layout");
  return {
    ok: true,
    message: `Consent withdrawn. Scouts and the club can no longer see ${firstName}'s stats.`,
    key: String(Date.now()),
  };
}

/**
 * Creates a guardian link (Surface 4, "Ask a guardian" and "Create a new
 * link"). The URL travels once, in the result's values; it is never put in a
 * URL, a redirect or a log.
 */
export async function requestConsentAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = requireSquadOrg(await requireRole(CONSENT_ADMIN_ROLES));
  const playerId = text(formData, "playerId");
  let created: Awaited<ReturnType<typeof createConsentRequest>>;
  try {
    created = await createConsentRequest(ctx, playerId);
  } catch (err) {
    if (err instanceof ConsentError) return consentError(err, LINK_NOT_CREATED);
    log.error({ err }, "consent link failed");
    return { ok: false, formError: LINK_NOT_CREATED };
  }
  revalidatePath("/squad", "layout");
  return {
    ok: true,
    message: "Guardian link created. Copy it below and send it.",
    values: { url: created.url, until: formatDate(created.expiresAt) },
    key: String(Date.now()),
  };
}

/** Turns off the open guardian link (Surface 4, "Turn off link"). The consent state stays. */
export async function revokeConsentRequestAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = requireSquadOrg(await requireRole(CONSENT_ADMIN_ROLES));
  const playerId = text(formData, "playerId");
  try {
    await revokeConsentRequest(ctx, playerId);
  } catch (err) {
    if (err instanceof ConsentError && err.code === "no_link") {
      return { ok: false, formError: "This link is already turned off." };
    }
    if (err instanceof ConsentError) return consentError(err, UNEXPECTED_ERROR);
    log.error({ err }, "consent link revoke failed");
    return { ok: false, formError: UNEXPECTED_ERROR };
  }
  revalidatePath("/squad", "layout");
  return { ok: true, message: "Guardian link turned off.", key: String(Date.now()) };
}
