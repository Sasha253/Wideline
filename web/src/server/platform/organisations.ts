import "server-only";
import { z } from "zod";
import type { OrganisationStatus, OrganisationType } from "@/generated/prisma/enums";
import { SELECTABLE_ORG_TYPES } from "@/lib/labels";
import { AuthzError, type AuthContext } from "../auth/session";
import { audit } from "../audit";
import { rawDb } from "../db/raw";
import {
  applicationApprovedEmail,
  applicationRejectedEmail,
  invitationUrl,
} from "../emails/organisation";
import { env } from "../env";
import { log } from "../log";
import { sendMail } from "../mail";
import {
  countryField,
  emailField,
  NAME_TOO_LONG,
  orgNameField,
  regionField,
} from "../organisations/fields";
import { invitationExpiry, newInvitationToken } from "../organisations/tokens";

/**
 * Platform operations on organisations (ADMIN01). These read and write across
 * tenants, so they use the raw client. Every export except the public
 * application takes a platform_admin AuthContext and checks it again here, so a
 * caller that forgot requireRole(PLATFORM_ROLES) still cannot use them.
 */

function assertPlatformAdmin(ctx: AuthContext): void {
  if (!ctx.roles.includes("platform_admin")) {
    throw new AuthzError(403, "Requires platform_admin");
  }
}

export class ApplicationError extends Error {
  constructor(
    readonly code:
      | "duplicate"
      | "spam"
      | "not_pending"
      | "not_found"
      | "not_active"
      | "has_owner"
      | "no_applicant",
  ) {
    super(`Organisation application: ${code}`);
    this.name = "ApplicationError";
  }
}

export const applicationSchema = z.object({
  name: orgNameField,
  type: z.enum(SELECTABLE_ORG_TYPES, { error: "Choose a type." }),
  country: countryField.default("ZA"),
  region: regionField,
  applicantName: z
    .string({ error: "Enter your name." })
    .trim()
    .min(1, { error: "Enter your name." })
    .max(120, { error: NAME_TOO_LONG }),
  applicantEmail: emailField,
  // Honeypot: people never see this field, so anything in it is a bot.
  website: z.string().optional(),
});

export type ApplicationInput = z.input<typeof applicationSchema>;

/**
 * The public "Join the pilot" form. Creates a pending organisation with no
 * members. A filled honeypot throws ApplicationError("spam") and creates
 * nothing; the page shows the same thanks either way.
 */
export async function submitOrganisationApplication(
  input: ApplicationInput,
  actorUserId: string | null = null,
): Promise<{ id: string }> {
  const data = applicationSchema.parse(input);
  if (data.website) throw new ApplicationError("spam");

  const duplicate = await rawDb.organisation.findFirst({
    where: {
      status: "pending",
      applicantEmail: { equals: data.applicantEmail, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (duplicate) throw new ApplicationError("duplicate");

  const org = await rawDb.organisation.create({
    data: {
      name: data.name,
      type: data.type,
      country: data.country,
      region: data.region,
      status: "pending",
      applicantName: data.applicantName,
      applicantEmail: data.applicantEmail,
    },
  });
  await audit({
    organisationId: org.id,
    actorUserId,
    action: "organisation.applied",
    targetType: "Organisation",
    targetId: org.id,
    metadata: { name: data.name, type: data.type, applicantEmail: data.applicantEmail },
  });
  return { id: org.id };
}

export type ApplicationRow = {
  id: string;
  name: string;
  type: OrganisationType;
  country: string;
  region: string | null;
  status: OrganisationStatus;
  applicantName: string | null;
  applicantEmail: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  /**
   * For an active organisation that applied but has no owner yet: the state of
   * its newest open owner invitation ("none" when every one was revoked or
   * accepted). Null when the organisation has an owner or is not active.
   */
  ownerInvitation: OwnerInvitationState | null;
};

export type OwnerInvitationState =
  | { status: "pending"; expiresAt: Date }
  | { status: "expired"; expiresAt: Date }
  | { status: "none" };

/**
 * Pending applications oldest first, or decided ones (applied through /apply
 * and then approved, rejected or suspended) newest first.
 */
export async function listOrganisationApplications(
  ctx: AuthContext,
  { status }: { status: "pending" | "decided" },
): Promise<ApplicationRow[]> {
  assertPlatformAdmin(ctx);
  const now = new Date();
  const rows = await rawDb.organisation.findMany({
    where:
      status === "pending"
        ? { status: "pending" }
        : { status: { not: "pending" }, reviewedAt: { not: null } },
    orderBy: status === "pending" ? { createdAt: "asc" } : { reviewedAt: "desc" },
    select: {
      id: true,
      name: true,
      type: true,
      country: true,
      region: true,
      status: true,
      applicantName: true,
      applicantEmail: true,
      createdAt: true,
      reviewedAt: true,
      rejectionReason: true,
      _count: { select: { memberships: { where: { role: "owner" } } } },
      invitations: {
        where: { role: "owner", acceptedAt: null, revokedAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { expiresAt: true },
      },
    },
  });
  return rows.map(({ _count, invitations, ...r }) => {
    let ownerInvitation: OwnerInvitationState | null = null;
    if (r.status === "active" && _count.memberships === 0) {
      const open = invitations[0];
      ownerInvitation = !open
        ? { status: "none" }
        : {
            status: open.expiresAt.getTime() <= now.getTime() ? "expired" : "pending",
            expiresAt: open.expiresAt,
          };
    }
    return { ...r, ownerInvitation };
  });
}

export async function countPendingApplications(ctx: AuthContext): Promise<number> {
  assertPlatformAdmin(ctx);
  return rawDb.organisation.count({ where: { status: "pending" } });
}

/** Moves a pending organisation to its decision. Throws not_pending when another admin got there first. */
async function decide(
  id: string,
  data: { status: "active" | "rejected"; rejectionReason?: string | null },
) {
  const org = await rawDb.organisation.findUnique({ where: { id } });
  if (!org) throw new ApplicationError("not_found");
  const now = new Date();
  const { count } = await rawDb.organisation.updateMany({
    where: { id, status: "pending" },
    data: { ...data, reviewedAt: now },
  });
  if (count !== 1) throw new ApplicationError("not_pending");
  return { org, now };
}

export type Decision = { name: string; applicantEmail: string | null; emailSent: boolean };

/** Emails the applicant their owner invitation link. False when the send failed (logged). */
async function sendOwnerInvitationEmail(
  org: { id: string; name: string; applicantName: string | null },
  invitation: { email: string; expiresAt: Date },
  token: string,
): Promise<boolean> {
  const { subject, text } = applicationApprovedEmail({
    orgName: org.name,
    applicantName: org.applicantName,
    url: invitationUrl(env().APP_URL, token),
    expiresAt: invitation.expiresAt,
  });
  try {
    await sendMail(invitation.email, subject, text);
    return true;
  } catch (err) {
    log.error(
      { err, organisationId: org.id, to: invitation.email },
      "owner invitation email failed",
    );
    return false;
  }
}

/**
 * Approves a pending organisation and emails the applicant an owner
 * invitation (14 days). The invitation is saved even when the email fails;
 * resendOwnerInvitation then issues a new link.
 */
export async function approveOrganisation(ctx: AuthContext, id: string): Promise<Decision> {
  assertPlatformAdmin(ctx);
  const { org, now } = await decide(id, { status: "active" });

  let emailSent = false;
  let invitationId: string | null = null;
  if (org.applicantEmail) {
    const { token, tokenHash } = newInvitationToken();
    const invitation = await rawDb.invitation.create({
      data: {
        organisationId: org.id,
        email: org.applicantEmail.toLowerCase(),
        inviteeName: org.applicantName,
        role: "owner",
        tokenHash,
        invitedById: ctx.user.id,
        expiresAt: invitationExpiry(now),
      },
    });
    invitationId = invitation.id;
    await audit({
      organisationId: org.id,
      actorUserId: ctx.user.id,
      action: "invitation.created",
      targetType: "Invitation",
      targetId: invitation.id,
      metadata: { email: invitation.email, role: "owner", replaced: false },
    });
    emailSent = await sendOwnerInvitationEmail(org, invitation, token);
  }

  await audit({
    organisationId: org.id,
    actorUserId: ctx.user.id,
    action: "organisation.approved",
    targetType: "Organisation",
    targetId: org.id,
    metadata: { invitationId, applicantEmail: org.applicantEmail, emailSent },
  });
  return { name: org.name, applicantEmail: org.applicantEmail, emailSent };
}

export type OwnerInvitationResent = {
  name: string;
  applicantEmail: string;
  expiresAt: Date;
  emailSent: boolean;
};

/**
 * Re-issues the owner invitation of an approved organisation that has no owner
 * yet (ADMIN01, AUTH04): when the approval email failed or the applicant let the
 * link expire. Nobody inside the organisation can do this, because it has no
 * members. Revokes every open owner invitation, creates a new one for the
 * applicant email with a fresh 14 days, emails it and audits invitation.resent.
 */
export async function resendOwnerInvitation(
  ctx: AuthContext,
  id: string,
): Promise<OwnerInvitationResent> {
  assertPlatformAdmin(ctx);
  const now = new Date();
  const { token, tokenHash } = newInvitationToken();

  const { org, invitation, previousInvitationIds } = await rawDb.$transaction(async (tx) => {
    // Updating the organisation row locks it until commit, so two admins who
    // resend at once run one after the other and only the last link works.
    const locked = await tx.organisation.updateMany({ where: { id }, data: { updatedAt: now } });
    if (locked.count !== 1) throw new ApplicationError("not_found");
    const org = await tx.organisation.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { memberships: { where: { role: "owner" } } } } },
    });
    if (org.status !== "active") throw new ApplicationError("not_active");
    if (org._count.memberships > 0) throw new ApplicationError("has_owner");
    if (!org.applicantEmail) throw new ApplicationError("no_applicant");

    const open = await tx.invitation.findMany({
      where: { organisationId: id, role: "owner", acceptedAt: null, revokedAt: null },
      select: { id: true },
    });
    await tx.invitation.updateMany({
      where: { id: { in: open.map((i) => i.id) } },
      data: { revokedAt: now },
    });
    const invitation = await tx.invitation.create({
      data: {
        organisationId: id,
        email: org.applicantEmail.toLowerCase(),
        inviteeName: org.applicantName,
        role: "owner",
        tokenHash,
        invitedById: ctx.user.id,
        expiresAt: invitationExpiry(now),
      },
    });
    return { org, invitation, previousInvitationIds: open.map((i) => i.id) };
  });

  await audit({
    organisationId: org.id,
    actorUserId: ctx.user.id,
    action: "invitation.resent",
    targetType: "Invitation",
    targetId: invitation.id,
    metadata: { email: invitation.email, role: "owner", previousInvitationIds, platform: true },
  });

  const emailSent = await sendOwnerInvitationEmail(org, invitation, token);
  return {
    name: org.name,
    applicantEmail: invitation.email,
    expiresAt: invitation.expiresAt,
    emailSent,
  };
}

export const rejectionReasonField = z
  .string()
  .trim()
  .max(500, { error: "Use 500 characters or fewer." })
  .optional()
  .transform((v) => (v ? v : null));

/** Rejects a pending organisation, keeps it for the record, and emails the applicant. */
export async function rejectOrganisation(
  ctx: AuthContext,
  id: string,
  reason?: string | null,
): Promise<Decision> {
  assertPlatformAdmin(ctx);
  const rejectionReason = rejectionReasonField.parse(reason ?? undefined);
  const { org } = await decide(id, { status: "rejected", rejectionReason });

  let emailSent = false;
  if (org.applicantEmail) {
    const { subject, text } = applicationRejectedEmail({
      orgName: org.name,
      applicantName: org.applicantName,
      reason: rejectionReason,
    });
    try {
      await sendMail(org.applicantEmail, subject, text);
      emailSent = true;
    } catch (err) {
      log.error({ err, organisationId: org.id }, "rejection email failed");
    }
  }

  await audit({
    organisationId: org.id,
    actorUserId: ctx.user.id,
    action: "organisation.rejected",
    targetType: "Organisation",
    targetId: org.id,
    metadata: { reason: rejectionReason, emailSent },
  });
  return { name: org.name, applicantEmail: org.applicantEmail, emailSent };
}
