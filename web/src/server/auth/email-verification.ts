import "server-only";
import { headers } from "next/headers";
import { log } from "../log";
import { auth } from "./auth";

/**
 * Sends Better Auth's email confirmation link (AUTH09), landing on
 * `callbackURL` (/scout by default) signed in. Signed out, Better Auth sends
 * only for an existing unconfirmed account; signed in, only to the session's
 * own email. False when the send failed or was refused (logged).
 */
export async function sendEmailConfirmation(
  email: string,
  callbackURL = "/scout",
): Promise<boolean> {
  try {
    await auth().api.sendVerificationEmail({
      body: { email, callbackURL },
      headers: await headers(),
    });
    return true;
  } catch (err) {
    log.error({ err }, "email confirmation send failed");
    return false;
  }
}
