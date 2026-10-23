import "server-only";
import { z } from "zod";
import type { Role } from "@/generated/prisma/enums";
import { ROLE_ORDER, type AuthContext } from "../auth/session";
import { audit } from "../audit";
import { invitationEmail, invitationUrl } from "../emails/organisation";
import { env } from "../env";
import { log } from "../log";
import { sendMail } from "../mail";
import { emailField, NAME_TOO_LONG } from "./fields";
import { assignableRoles, RoleRuleError } from "./roles";
import { invitationExpiry, newInvitationToken } from "./tokens";

/**
 * Invitations, organisation side (AUTH-04). Everything here goes through the
 * caller's scoped client (ctx.db), so an admin only ever sees and changes their
 * own organisation's invitations. The accept side, where the invitee is not a
 * member yet, is src/server/auth/invitations.ts.
 */

export type InvitationStatus = "pending" | "expired" | "accepted" | "revoked";

export function invitationStatus(
  inv: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now = new Date(),
): InvitationStatus {
  if (inv.acceptedAt) return "accepted";
  if (inv.revokedAt) return "revoked";
  return inv.expiresAt.getTime() <= now.getTime() ? "expired" : "pending";
}

export const inviteSchema = z.object({
  email: emailField,
  role: z.enum(ROLE_ORDER as [Role, ...Role[]]),
  name: z
    .string()
    .trim()
    .max(120, { error: NAME_TOO_LONG })
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export type InviteInput = z.input<typeof inviteSchema>;

export type InvitationErrorCode = "already_member" | "not_found";

export class InvitationRuleError extends Error {
  constructor(readonly code: InvitationErrorCode) {
    super(`Invitation: ${code}`);
    this.name = "InvitationRuleError";
  }
}

export type SentInvitation = {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
  /** An earlier pending invitation for the same email and role was revoked. */
  replaced: boolean;
  /** False when the invitation is saved but the email failed; the admin can resend. */
  emailSent: boolean;
};

async function sendInvitationEmail(
  ctx: AuthContext,
  inv: { email: string; role: Role; inviteeName: string | null; expiresAt: Date },
  token: string,
): Promise<boolean> {
  const { subject, text } = invitationEmail({
    orgName: ctx.organisationName,
    role: inv.role,
    inviterName: ctx.user.name,
    inviteeName: inv.inviteeName,
    url: invitationUrl(env().APP_URL, token),
    expiresAt: inv.expiresAt,
  });
  try {
    await sendMail(inv.email, subject, text);
    return true;
  } catch (err) {
    log.error({ err, organisationId: ctx.organisationId }, "invitation email failed");
    return false;
  }
}

/**
 * Invites an email with a role. Inviting the same email and role again revokes
 * the earlier pending invitation, so it doubles as a resend.
 */
export async function createInvitation(
  ctx: AuthContext,
  input: InviteInput,
): Promise<SentInvitation> {
  const { email, role, name } = inviteSchema.parse(input);
  if (!assignableRoles(ctx.roles).includes(role)) throw new RoleRuleError("not_assignable");

  const member = await ctx.db.membership.findFirst({
    where: { role, user: { email: { equals: email, mode: "insensitive" } } },
    select: { id: true },
  });
  if (member) throw new InvitationRuleError("already_member");

  const now = new Date();
  const { token, tokenHash } = newInvitationToken();
  const { replaced, invitation } = await ctx.db.$transaction(async (tx) => {
    const { count } = await tx.invitation.updateMany({
      where: { email, role, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    const invitation = await tx.invitation.create({
      data: {
        organisationId: ctx.organisationId,
        email,
        role,
        inviteeName: name ?? null,
        tokenHash,
        invitedById: ctx.user.id,
        expiresAt: invitationExpiry(now),
      },
    });
    return { replaced: count > 0, invitation };
  });

  await audit({
    organisationId: ctx.organisationId,
    actorUserId: ctx.user.id,
    action: "invitation.created",
    targetType: "Invitation",
    targetId: invitation.id,
    metadata: { email, role, replaced },
  });

  const emailSent = await sendInvitationEmail(ctx, invitation, token);
  return { id: invitation.id, email, role, expiresAt: invitation.expiresAt, replaced, emailSent };
}

export type InvitationRow = {
  id: string;
  email: string;
  inviteeName: string | null;
  role: Role;
  status: InvitationStatus;
  expiresAt: Date;
  createdAt: Date;
  inviterName: string | null;
};

/** Open invitations (pending or expired), newest first. Accepted and revoked ones are left out. */
export async function listInvitations(
  ctx: AuthContext,
  now = new Date(),
): Promise<InvitationRow[]> {
  const rows = await ctx.db.invitation.findMany({
    where: { acceptedAt: null, revokedAt: null },
    include: { invitedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    inviteeName: r.inviteeName,
    role: r.role,
    status: invitationStatus(r, now),
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    inviterName: r.invitedBy?.name ?? null,
  }));
}

async function findOpen(ctx: AuthContext, id: string) {
  const inv = await ctx.db.invitation.findFirst({
    where: { id, acceptedAt: null, revokedAt: null },
  });
  if (!inv) throw new InvitationRuleError("not_found");
  return inv;
}

/** Revokes an open invitation; its link stops working straight away. */
export async function revokeInvitation(
  ctx: AuthContext,
  id: string,
): Promise<{ email: string; role: Role }> {
  const inv = await findOpen(ctx, id);
  if (!assignableRoles(ctx.roles).includes(inv.role)) throw new RoleRuleError("not_assignable");
  const { count } = await ctx.db.invitation.updateMany({
    where: { id, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count !== 1) throw new InvitationRuleError("not_found");
  await audit({
    organisationId: ctx.organisationId,
    actorUserId: ctx.user.id,
    action: "invitation.revoked",
    targetType: "Invitation",
    targetId: id,
    metadata: { email: inv.email, role: inv.role },
  });
  return { email: inv.email, role: inv.role };
}

/** Revokes an open invitation and sends a new token with a fresh 14 days. */
export async function resendInvitation(ctx: AuthContext, id: string): Promise<SentInvitation> {
  const old = await findOpen(ctx, id);
  if (!assignableRoles(ctx.roles).includes(old.role)) throw new RoleRuleError("not_assignable");

  const now = new Date();
  const { token, tokenHash } = newInvitationToken();
  const invitation = await ctx.db.$transaction(async (tx) => {
    const { count } = await tx.invitation.updateMany({
      where: { id, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    if (count !== 1) throw new InvitationRuleError("not_found");
    return tx.invitation.create({
      data: {
        organisationId: ctx.organisationId,
        email: old.email,
        role: old.role,
        inviteeName: old.inviteeName,
        tokenHash,
        invitedById: ctx.user.id,
        expiresAt: invitationExpiry(now),
      },
    });
  });

  await audit({
    organisationId: ctx.organisationId,
    actorUserId: ctx.user.id,
    action: "invitation.resent",
    targetType: "Invitation",
    targetId: invitation.id,
    metadata: { email: old.email, role: old.role, previousInvitationId: id },
  });

  const emailSent = await sendInvitationEmail(ctx, invitation, token);
  return {
    id: invitation.id,
    email: old.email,
    role: old.role,
    expiresAt: invitation.expiresAt,
    replaced: true,
    emailSent,
  };
}
