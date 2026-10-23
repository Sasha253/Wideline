import "server-only";
import type { Email } from "./organisation";

// Plain-text scout emails for C02 (docs/build/design/C02.md, Surface 7).
// Sentence case, British and South African spelling, no exclamation marks, no
// emoji. Sent through sendMail (src/server/mail.ts); Mailpit catches them
// locally. The "reply to this email" lines wait for a Reply-To (C16).
//
// Draft copy

const SIGN_OFF = "The Wideline team";

const base = (appUrl: string) => appUrl.replace(/\/$/, "");

function email(name: string, subject: string, lines: string[]): Email {
  return { subject, text: [`Hello ${name},`, ...lines, SIGN_OFF].join("\n\n") };
}

// Draft copy
export function verifyEmailEmail({ name, url }: { name: string; url: string }): Email {
  return email(name, "Confirm your email for Wideline", [
    `Confirm this email address for your Wideline account: ${url}`,
    "We cannot approve a scout registration until the email is confirmed.",
    "If you did not register on Wideline, you can ignore this email.",
  ]);
}

// Draft copy
export function scoutRegisteredEmail({ name, appUrl }: { name: string; appUrl: string }): Email {
  return email(name, "We have your scout registration", [
    "Thanks for registering as a scout on Wideline. A Wideline admin checks every scout before they can review matches. We email you when your registration is decided.",
    "If you have not confirmed your email yet, use the link in our other email.",
    `See where your registration stands: ${base(appUrl)}/scout`,
  ]);
}

// Draft copy
export function scoutApprovedEmail({ name, appUrl }: { name: string; appUrl: string }): Email {
  return email(name, "You can now review matches on Wideline", [
    `We approved your scout registration. Open the review queue to claim your first match: ${base(appUrl)}/review`,
    "Remember the terms you accepted: watch footage only inside Wideline, never download or record it, and do not contact players or clubs about what you see.",
  ]);
}

// Draft copy
export function scoutRejectedEmail({
  name,
  reason,
}: {
  name: string;
  reason?: string | null;
}): Email {
  return email(name, "Your Wideline scout registration", [
    "We could not approve your scout registration.",
    ...(reason ? [`Reason: ${reason}`] : []),
    "If you have questions, reply to this email.",
  ]);
}

// Draft copy
export function scoutSuspendedEmail({ name, reason }: { name: string; reason: string }): Email {
  return email(name, "Your Wideline review access is suspended", [
    "We suspended your review access on Wideline, so you cannot claim or review matches.",
    `Reason: ${reason}`,
    "If you have questions, reply to this email.",
  ]);
}

// Draft copy
export function scoutReinstatedEmail({
  name,
  appUrl,
  termsStale,
}: {
  name: string;
  appUrl: string;
  termsStale: boolean;
}): Email {
  return email(name, "Your Wideline review access is back", [
    `We reinstated your review access. Open the review queue: ${base(appUrl)}/review`,
    ...(termsStale
      ? [
          `First accept the current confidentiality terms on your scout profile: ${base(appUrl)}/scout`,
        ]
      : []),
  ]);
}
