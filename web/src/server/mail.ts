import "server-only";
import { env } from "./env";
import { deliverMail } from "./mail-transport";

/** Sends one email. `html` is an optional HTML part next to the plain text (C05 guardian link). */
export async function sendMail(
  to: string,
  subject: string,
  text: string,
  html?: string,
): Promise<void> {
  // env() checks the SMTP settings at first use; the transport reads the same variables.
  env();
  await deliverMail(to, subject, text, html);
}
