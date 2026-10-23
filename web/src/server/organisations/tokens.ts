import "server-only";
import { createHash, randomBytes } from "node:crypto";

/** Invitations last 14 days (AUTH-04). */
export const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** A new invitation token (256 bits, URL-safe) and the hash that is stored. */
export function newInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

/** Only this sha256 hash is stored; the raw token lives only in the email link. */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function invitationExpiry(from = new Date()): Date {
  return new Date(from.getTime() + INVITATION_TTL_MS);
}
