"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { UNEXPECTED_ERROR, type ActionResult } from "@/lib/action-result";
import { formatDate } from "@/lib/labels";
import { PLATFORM_ROLES, requireRole } from "@/server/auth/session";
import { log } from "@/server/log";
import {
  ApplicationError,
  approveOrganisation,
  rejectOrganisation,
  resendOwnerInvitation,
} from "@/server/platform/organisations";

// Server actions for /admin/organisations (ADMIN01). Platform admins only.

const PATH = "/admin/organisations";

function decisionError(err: unknown, name: string): ActionResult {
  if (err instanceof ApplicationError) {
    revalidatePath(PATH);
    return { ok: false, formError: `${name} has already been decided.` };
  }
  if (err instanceof ZodError) return { ok: false, formError: "Use 500 characters or fewer." };
  log.error({ err }, "organisation decision failed");
  return { ok: false, formError: UNEXPECTED_ERROR };
}

export async function approveOrganisationAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(PLATFORM_ROLES);
  const name = String(formData.get("name") ?? "This organisation");
  try {
    const res = await approveOrganisation(ctx, String(formData.get("organisationId") ?? ""));
    revalidatePath(PATH);
    if (!res.emailSent) {
      return {
        ok: true,
        tone: "warn",
        message: res.applicantEmail
          ? `Approved ${res.name}, but the owner invitation email to ${res.applicantEmail} did not send. Use Resend owner invitation to try again.`
          : `Approved ${res.name}, but it has no applicant email, so we sent no owner invitation.`,
      };
    }
    return {
      ok: true,
      message: `Approved ${res.name}. We emailed an owner invitation to ${res.applicantEmail}.`,
    };
  } catch (err) {
    return decisionError(err, name);
  }
}

export async function rejectOrganisationAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(PLATFORM_ROLES);
  const name = String(formData.get("name") ?? "This organisation");
  try {
    const res = await rejectOrganisation(
      ctx,
      String(formData.get("organisationId") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    revalidatePath(PATH);
    return {
      ok: true,
      tone: res.emailSent ? "ok" : "warn",
      message: res.emailSent
        ? `Rejected ${res.name}. We emailed ${res.applicantEmail}.`
        : `Rejected ${res.name}, but the email to ${res.applicantEmail ?? "the applicant"} did not send. Check the mail logs.`,
    };
  } catch (err) {
    return decisionError(err, name);
  }
}

const RESEND_ERRORS: Partial<Record<ApplicationError["code"], (name: string) => string>> = {
  not_found: (name) => `${name} no longer exists.`,
  not_active: (name) => `${name} is not active, so it cannot get an owner invitation.`,
  has_owner: (name) => `${name} already has an owner. They can invite people from Settings.`,
  no_applicant: (name) => `${name} has no applicant email to invite.`,
};

/**
 * Sends a new owner invitation to the applicant of an approved organisation
 * that has no owner yet: the approval email failed or the link expired.
 */
export async function resendOwnerInvitationAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(PLATFORM_ROLES);
  const name = String(formData.get("name") ?? "This organisation");
  try {
    const res = await resendOwnerInvitation(ctx, String(formData.get("organisationId") ?? ""));
    revalidatePath(PATH);
    if (!res.emailSent) {
      return {
        ok: true,
        tone: "warn",
        message: `The new owner invitation for ${res.name} is saved, but the email to ${res.applicantEmail} did not send. Use Resend owner invitation to try again.`,
      };
    }
    return {
      ok: true,
      message: `We emailed a new owner invitation for ${res.name} to ${res.applicantEmail}. It expires on ${formatDate(res.expiresAt)}.`,
    };
  } catch (err) {
    const message = err instanceof ApplicationError ? RESEND_ERRORS[err.code]?.(name) : undefined;
    if (message) {
      revalidatePath(PATH);
      return { ok: false, formError: message };
    }
    log.error({ err }, "owner invitation resend failed");
    return { ok: false, formError: UNEXPECTED_ERROR };
  }
}
