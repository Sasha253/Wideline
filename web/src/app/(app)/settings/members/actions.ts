"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import type { Role } from "@/generated/prisma/enums";
import { fieldErrorsFrom, UNEXPECTED_ERROR, type ActionResult } from "@/lib/action-result";
import { formatDate, ROLE_LABELS, roleInText } from "@/lib/labels";
import { ORG_ADMIN_ROLES, requireRole, type AuthContext } from "@/server/auth/session";
import { log } from "@/server/log";
import {
  createInvitation,
  InvitationRuleError,
  resendInvitation,
  revokeInvitation,
  type SentInvitation,
} from "@/server/organisations/invitations";
import {
  changeMemberRole,
  MembershipError,
  removeMembership,
} from "@/server/organisations/members";
import { RoleRuleError } from "@/server/organisations/roles";

// Server actions for /settings/members. Each one checks ORG_ADMIN_ROLES first.

const PATH = "/settings/members";
const EMAIL_FAILED =
  "The invitation is saved, but the email did not send. Use Resend to try again.";

const str = (formData: FormData, name: string) => String(formData.get(name) ?? "");

function sentResult(sent: SentInvitation): ActionResult {
  if (!sent.emailSent) return { ok: true, tone: "warn", message: EMAIL_FAILED, key: sent.id };
  return {
    ok: true,
    key: sent.id,
    message: sent.replaced
      ? `New invitation sent to ${sent.email}. The earlier link no longer works.`
      : `Invitation sent to ${sent.email}. It expires on ${formatDate(sent.expiresAt)}.`,
  };
}

function ruleError(err: unknown, ctx: AuthContext, name?: string, role?: Role): ActionResult {
  if (err instanceof RoleRuleError) {
    if (err.code === "last_owner") {
      return {
        ok: false,
        formError: `${ctx.organisationName} needs at least one owner. Make someone else an owner first.`,
      };
    }
    if (err.code === "owner_only") {
      return { ok: false, formError: "Only an owner can change an owner's role." };
    }
    return { ok: false, formError: "You cannot give that role." };
  }
  if (err instanceof MembershipError && err.code === "same_role" && name && role) {
    return { ok: false, formError: `${name} is already ${roleInText(role)} here.` };
  }
  if (err instanceof MembershipError || err instanceof InvitationRuleError) {
    // The row is gone: someone else changed it. Re-render with fresh data.
    revalidatePath(PATH);
  }
  log.error({ err }, "members action failed");
  return { ok: false, formError: UNEXPECTED_ERROR };
}

export async function inviteMember(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireRole(ORG_ADMIN_ROLES);
  const email = str(formData, "email");
  try {
    const sent = await createInvitation(ctx, {
      email,
      role: str(formData, "role") as Role,
      name: str(formData, "name"),
    });
    revalidatePath(PATH);
    return sentResult(sent);
  } catch (err) {
    if (err instanceof ZodError) {
      const fieldErrors = fieldErrorsFrom(err.issues);
      if (fieldErrors.role) return { ok: false, formError: "You cannot give that role." };
      return { ok: false, fieldErrors };
    }
    if (err instanceof InvitationRuleError && err.code === "already_member") {
      const role = str(formData, "role") as Role;
      return {
        ok: false,
        formError: `${email.trim().toLowerCase()} is already ${roleInText(role)} at ${ctx.organisationName}.`,
      };
    }
    return ruleError(err, ctx);
  }
}

export async function resendInvitationAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(ORG_ADMIN_ROLES);
  try {
    const sent = await resendInvitation(ctx, str(formData, "invitationId"));
    revalidatePath(PATH);
    return sentResult(sent);
  } catch (err) {
    return ruleError(err, ctx);
  }
}

export async function revokeInvitationAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(ORG_ADMIN_ROLES);
  try {
    const { email } = await revokeInvitation(ctx, str(formData, "invitationId"));
    revalidatePath(PATH);
    return { ok: true, message: `Invitation to ${email} revoked.`, key: String(Date.now()) };
  } catch (err) {
    return ruleError(err, ctx);
  }
}

export async function changeMemberRoleAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(ORG_ADMIN_ROLES);
  const role = str(formData, "role") as Role;
  const name = str(formData, "memberName");
  if (!ROLE_LABELS[role]) return { ok: false, formError: "You cannot give that role." };
  try {
    const res = await changeMemberRole(ctx, str(formData, "membershipId"), role);
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `${res.name} is now ${roleInText(res.to)}.`,
      key: String(Date.now()),
    };
  } catch (err) {
    return ruleError(err, ctx, name, role);
  }
}

export async function removeMemberAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(ORG_ADMIN_ROLES);
  let removed: Awaited<ReturnType<typeof removeMembership>>;
  try {
    removed = await removeMembership(ctx, str(formData, "membershipId"));
  } catch (err) {
    return ruleError(err, ctx);
  }
  revalidatePath("/", "layout");
  // The actor removed their own last owner or admin role here: they lose this page.
  const remaining = ctx.roles.filter((r) => r !== removed.role);
  if (removed.userId === ctx.user.id && !remaining.some((r) => ORG_ADMIN_ROLES.includes(r))) {
    redirect("/");
  }
  return {
    ok: true,
    message: `Removed ${removed.name} as ${ROLE_LABELS[removed.role].toLowerCase()}.`,
    key: String(Date.now()),
  };
}
