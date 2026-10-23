"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { UNEXPECTED_ERROR, type ActionResult } from "@/lib/action-result";
import { PLATFORM_ROLES, requireRole } from "@/server/auth/session";
import { log } from "@/server/log";
import {
  approveScout,
  linkAffiliation,
  reinstateScout,
  rejectScout,
  ScoutDecisionError,
  suspendScout,
} from "@/server/platform/scouts";

// Server actions for /admin/scouts (AUTH08, ADMIN01, ADMIN06). Platform admins only.

const PATH = "/admin/scouts";

const DECISION_ERRORS: Partial<Record<ScoutDecisionError["code"], (name: string) => string>> = {
  not_found: (name) => `${name} has already been decided. The list is up to date now.`,
  not_pending: (name) => `${name} has already been decided. The list is up to date now.`,
  not_approved: (name) => `${name} is no longer approved, so they cannot be suspended.`,
  not_suspended: (name) => `${name} is no longer suspended.`,
  email_unconfirmed: (name) =>
    `${name} has not confirmed their email yet, so you cannot approve them.`,
};

function decisionError(err: unknown, name: string): ActionResult {
  const message = err instanceof ScoutDecisionError ? DECISION_ERRORS[err.code]?.(name) : undefined;
  if (message) {
    revalidatePath(PATH);
    return { ok: false, formError: message };
  }
  // The reason field: shown under it in the dialog, which stays open.
  if (err instanceof ZodError) {
    return { ok: false, fieldErrors: { reason: err.issues[0]?.message ?? UNEXPECTED_ERROR } };
  }
  log.error({ err }, "scout decision failed");
  return { ok: false, formError: UNEXPECTED_ERROR };
}

const nameOf = (formData: FormData) => String(formData.get("name") ?? "This scout");
const idOf = (formData: FormData) => String(formData.get("profileId") ?? "");

export async function approveScoutAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(PLATFORM_ROLES);
  const name = nameOf(formData);
  try {
    const res = await approveScout(ctx, idOf(formData));
    revalidatePath(PATH);
    return res.emailSent
      ? {
          ok: true,
          message: `Approved ${res.name}. We emailed them a link to the review queue.`,
          key: randomUUID(),
        }
      : {
          ok: true,
          tone: "warn",
          message: `Approved ${res.name}, but the email to ${res.email} did not send. They can still sign in and review matches.`,
          key: randomUUID(),
        };
  } catch (err) {
    return decisionError(err, name);
  }
}

export async function rejectScoutAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(PLATFORM_ROLES);
  const name = nameOf(formData);
  try {
    const res = await rejectScout(ctx, idOf(formData), String(formData.get("reason") ?? ""));
    revalidatePath(PATH);
    return {
      ok: true,
      tone: res.emailSent ? "ok" : "warn",
      message: res.emailSent
        ? `Rejected ${res.name}. We emailed ${res.email}.`
        : `Rejected ${res.name}, but the email to ${res.email} did not send.`,
      key: randomUUID(),
    };
  } catch (err) {
    return decisionError(err, name);
  }
}

export async function suspendScoutAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(PLATFORM_ROLES);
  const name = nameOf(formData);
  try {
    const res = await suspendScout(ctx, idOf(formData), String(formData.get("reason") ?? ""));
    revalidatePath(PATH);
    return {
      ok: true,
      tone: res.emailSent ? "ok" : "warn",
      message: res.emailSent
        ? `Suspended ${res.name}. We emailed ${res.email} the reason.`
        : `Suspended ${res.name}, but the email to ${res.email} did not send.`,
      key: randomUUID(),
    };
  } catch (err) {
    return decisionError(err, name);
  }
}

export async function reinstateScoutAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(PLATFORM_ROLES);
  const name = nameOf(formData);
  try {
    const res = await reinstateScout(ctx, idOf(formData));
    revalidatePath(PATH);
    return {
      ok: true,
      tone: res.emailSent ? "ok" : "warn",
      message: res.emailSent
        ? `Reinstated ${res.name}. We emailed ${res.email}.`
        : `Reinstated ${res.name}, but the email to ${res.email} did not send.`,
      key: randomUUID(),
    };
  } catch (err) {
    return decisionError(err, name);
  }
}

export async function linkAffiliationAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(PLATFORM_ROLES);
  const scoutName = nameOf(formData);
  try {
    const res = await linkAffiliation(
      ctx,
      String(formData.get("affiliationId") ?? ""),
      String(formData.get("organisationId") ?? "") || null,
    );
    revalidatePath(PATH);
    return {
      ok: true,
      message: res.organisationName
        ? `Matched ${res.name} to ${res.organisationName}.`
        : `${res.name} is checked and not matched to a Wideline organisation.`,
      key: randomUUID(),
    };
  } catch (err) {
    if (err instanceof ScoutDecisionError && err.code === "affiliation_removed") {
      revalidatePath(PATH);
      return {
        ok: false,
        formError: `${scoutName} removed this conflict, so it cannot be matched.`,
      };
    }
    if (err instanceof ScoutDecisionError && err.code === "org_inactive") {
      revalidatePath(PATH);
      return { ok: false, formError: "That organisation is no longer active. Choose another." };
    }
    log.error({ err }, "scout affiliation link failed");
    return { ok: false, formError: UNEXPECTED_ERROR };
  }
}
