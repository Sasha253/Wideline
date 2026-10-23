import "server-only";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { audit } from "../audit";
import { rawDb } from "../db/raw";
import { passwordField } from "../scouts/fields";

/**
 * Passwords for accounts that start without one (AUTH09). A self-registered
 * scout gets no password at registration, because a signed-out form proves
 * nothing about the email: whoever typed it could be anyone. The mailbox owner
 * signs in through the confirmation or magic link, then sets a password here.
 */

export type PasswordErrorCode = "unverified" | "already_set";

export class PasswordError extends Error {
  constructor(readonly code: PasswordErrorCode) {
    super(`Password refused: ${code}`);
    this.name = "PasswordError";
  }
}

export const setPasswordSchema = z.object({ password: passwordField });

/** True when the user can sign in with a password. */
export async function hasPassword(userId: string): Promise<boolean> {
  const count = await rawDb.account.count({
    where: { userId, providerId: "credential", password: { not: null } },
  });
  return count > 0;
}

/**
 * Sets the first password of a signed-in user (the session user, never a form
 * field). Refused unless the email is verified and no password exists yet: it
 * never replaces a password, so a stolen session cannot lock the owner out.
 * The user row is locked, so two concurrent calls give one password. Throws
 * ZodError for a short or long password.
 */
export async function setOwnPassword(userId: string, password: string): Promise<void> {
  const data = setPasswordSchema.parse({ password });
  const hash = await hashPassword(data.password);
  const accountId = await rawDb.$transaction(async (tx) => {
    const [user] = await tx.$queryRaw<{ emailVerified: boolean }[]>`
      SELECT "emailVerified" FROM "User" WHERE id = ${userId} FOR UPDATE`;
    if (!user?.emailVerified) throw new PasswordError("unverified");
    const existing = await tx.account.findFirst({
      where: { userId, providerId: "credential" },
      select: { id: true, password: true },
    });
    if (existing?.password) throw new PasswordError("already_set");
    if (existing) {
      await tx.account.update({ where: { id: existing.id }, data: { password: hash } });
      return existing.id;
    }
    const created = await tx.account.create({
      data: {
        id: randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: hash,
      },
    });
    return created.id;
  });
  await audit({
    organisationId: null,
    actorUserId: userId,
    action: "auth.password_set",
    targetType: "Account",
    targetId: accountId,
    metadata: {},
  });
}

/**
 * Deletes every account link and session of a user whose email is not proven
 * yet, the moment it is proven (Better Auth's beforeEmailVerification). Such
 * access may belong to whoever typed the email, not to its owner. A verified
 * user is left alone.
 */
export async function revokeUnprovenAccess(userId: string): Promise<void> {
  const user = await rawDb.user.findUnique({
    where: { id: userId },
    select: { emailVerified: true },
  });
  if (!user || user.emailVerified) return;
  const [accounts, sessions] = await rawDb.$transaction([
    rawDb.account.deleteMany({ where: { userId } }),
    rawDb.session.deleteMany({ where: { userId } }),
  ]);
  if (accounts.count || sessions.count) {
    await audit({
      organisationId: null,
      actorUserId: userId,
      action: "auth.unproven_access_revoked",
      targetType: "User",
      targetId: userId,
      metadata: { accounts: accounts.count, sessions: sessions.count },
    });
  }
}
