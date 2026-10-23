import "server-only";
import type { Role } from "@/generated/prisma/enums";
import { formatDate, roleInText } from "@/lib/labels";

// Plain-text emails for C01 (docs/build/design/C01.md, "Emails"). Sentence
// case, British and South African spelling, no exclamation marks, no emoji.
// Sent through sendMail (src/server/mail.ts); Mailpit catches them locally.

export type Email = { subject: string; text: string };

const SIGN_OFF = "The Wideline team";

export function invitationEmail({
  orgName,
  role,
  inviterName,
  inviteeName,
  url,
  expiresAt,
}: {
  orgName: string;
  role: Role;
  inviterName: string | null;
  inviteeName?: string | null;
  url: string;
  expiresAt: Date;
}): Email {
  const who = inviterName ?? "Someone";
  return {
    subject: inviterName
      ? `${inviterName} invited you to ${orgName} on Wideline`
      : `You are invited to ${orgName} on Wideline`,
    text: [
      inviteeName ? `Hello ${inviteeName},` : "Hello,",
      inviterName
        ? `${who} invited you to join ${orgName} on Wideline as ${roleInText(role)}.`
        : `You are invited to join ${orgName} on Wideline as ${roleInText(role)}.`,
      `Accept the invitation: ${url}`,
      `This link expires on ${formatDate(expiresAt)}. If you were not expecting this email, you can ignore it.`,
      SIGN_OFF,
    ].join("\n\n"),
  };
}

export function applicationApprovedEmail({
  orgName,
  applicantName,
  url,
  expiresAt,
}: {
  orgName: string;
  applicantName: string | null;
  url: string;
  expiresAt: Date;
}): Email {
  return {
    subject: `${orgName} is approved for the Wideline pilot`,
    text: [
      applicantName ? `Hello ${applicantName},` : "Hello,",
      `We approved ${orgName} for the Wideline pilot. Set up your owner account to invite your coaches and staff: ${url}`,
      `This link expires on ${formatDate(expiresAt)}.`,
      SIGN_OFF,
    ].join("\n\n"),
  };
}

export function applicationRejectedEmail({
  orgName,
  applicantName,
  reason,
}: {
  orgName: string;
  applicantName: string | null;
  reason?: string | null;
}): Email {
  return {
    subject: `Your Wideline pilot application for ${orgName}`,
    text: [
      applicantName ? `Hello ${applicantName},` : "Hello,",
      `We could not approve ${orgName} for the Wideline pilot this time.`,
      ...(reason ? [`Reason: ${reason}`] : []),
      "If you have questions, reply to this email.",
      SIGN_OFF,
    ].join("\n\n"),
  };
}

/** The accept link for an invitation token. */
export function invitationUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/invite/${token}`;
}
