import { randomUUID } from "node:crypto";
import { createEmailVerificationToken } from "better-auth/api";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/server/auth/auth";
import { acceptInvitation } from "@/server/auth/invitations";
import { hasPassword, setOwnPassword } from "@/server/auth/password";
import type { AuthContext } from "@/server/auth/session";
import { rawDb } from "@/server/db/raw";
import { env } from "@/server/env";
import { createInvitation } from "@/server/organisations/invitations";
import { registerScout } from "@/server/scouts/registration";
import { fixtures } from "./helpers/fixtures";
import { randomSaId } from "./helpers/scouts";

// AUTH09 with AUTH04: a signed-out scout registration proves nothing about the
// email, so it must never leave its typist a way into the account. Before C02
// every account came from an invitation, so its email was proven. The attack:
// register as victim@club, let the victim confirm and later accept a club
// invitation into the same account, then sign in with the planted password.

const sendMail = vi.hoisted(() => vi.fn());
vi.mock("@/server/mail", () => ({ sendMail }));

const f = fixtures();
const emailOf = (local: string) => `${local}-${f.tag}@test.local`;
const ATTACKER_PASSWORD = "attacker-chosen-password";
const OWNER_PASSWORD = "owner-chosen-password";

let club: { id: string };
let asOwner: AuthContext;

async function register(local: string) {
  try {
    return await registerScout({
      input: {
        name: "Victim Coach",
        email: emailOf(local),
        phone: "082 123 4567",
        idDocumentType: "sa_id",
        idNumber: randomSaId(),
        noAffiliations: true,
        acceptTerms: true,
      },
    });
  } finally {
    await f.trackUserByEmail(emailOf(local));
  }
}

/** Opens the confirmation link, as the mailbox owner does. Returns the new session token. */
async function confirm(email: string): Promise<string | null> {
  const token = await createEmailVerificationToken(env().BETTER_AUTH_SECRET, email);
  const res = await auth().api.verifyEmail({ query: { token }, asResponse: true });
  const cookie = res.headers.get("set-cookie") ?? "";
  const signed = /better-auth\.session_token=([^;]+)/.exec(cookie)?.[1];
  return signed ? decodeURIComponent(signed).split(".")[0]! : null;
}

async function signIn(email: string, password: string) {
  return auth().api.signInEmail({ body: { email, password } });
}

/** The session behind a raw token, as Better Auth resolves a cookie. */
async function sessionFor(token: string) {
  const s = await rawDb.session.findUnique({ where: { token } });
  return s && s.expiresAt > new Date() ? s : null;
}

async function inviteToClub(email: string) {
  sendMail.mockClear();
  await createInvitation(asOwner, { email, role: "coach" });
  const text = sendMail.mock.calls.at(-1)![2] as string;
  return text.match(/\/invite\/([\w-]+)/)![1]!;
}

beforeAll(async () => {
  club = await f.org("Proof FC");
  const owner = await f.user("Proof Owner");
  await f.member(club.id, owner.id, "owner");
  asOwner = await f.ctx(owner, club.id);
});

beforeEach(() => {
  sendMail.mockReset();
});

afterAll(async () => {
  await f.cleanup();
});

describe("signed-out scout registration", () => {
  it("leaves no password and no session, so nobody can sign in with what they typed", async () => {
    const res = await register("plain");
    expect(await rawDb.account.count({ where: { userId: res.userId } })).toBe(0);
    expect(await rawDb.session.count({ where: { userId: res.userId } })).toBe(0);
    expect(await hasPassword(res.userId)).toBe(false);
    await expect(signIn(res.email, ATTACKER_PASSWORD)).rejects.toThrow();
  });

  it("confirming signs the owner in; only then can they set the one password", async () => {
    const res = await register("owner");
    await expect(setOwnPassword(res.userId, OWNER_PASSWORD)).rejects.toMatchObject({
      code: "unverified",
    });

    const token = await confirm(res.email);
    const user = await rawDb.user.findUniqueOrThrow({ where: { id: res.userId } });
    expect(user.emailVerified).toBe(true);
    expect(token && (await sessionFor(token))?.userId).toBe(res.userId);

    await setOwnPassword(res.userId, OWNER_PASSWORD);
    expect(await hasPassword(res.userId)).toBe(true);
    const signedIn = await signIn(res.email, OWNER_PASSWORD);
    expect(signedIn.user.id).toBe(res.userId);
    // Never replaces a password, so a stolen session cannot take the account over.
    await expect(setOwnPassword(res.userId, ATTACKER_PASSWORD)).rejects.toMatchObject({
      code: "already_set",
    });
    expect(
      await rawDb.auditLog.count({
        where: { action: "auth.password_set", actorUserId: res.userId },
      }),
    ).toBe(1);
  });

  it("register as the victim, victim confirms and joins a club: the attacker gets nothing", async () => {
    // The attacker registers the victim's email, then tries their password.
    const res = await register("victim");
    await expect(signIn(res.email, ATTACKER_PASSWORD)).rejects.toThrow();

    // Worst case, an unproven account already holds a planted password and
    // session (a pre-fix account, or any future path that creates one).
    await rawDb.account.create({
      data: {
        id: randomUUID(),
        accountId: res.userId,
        providerId: "credential",
        userId: res.userId,
        password: await hashPassword(ATTACKER_PASSWORD),
      },
    });
    const planted = await f.session(res.userId);
    // An unverified email never signs in with a password (requireEmailVerification).
    await expect(signIn(res.email, ATTACKER_PASSWORD)).rejects.toThrow("Email not verified");

    // The victim opens the confirmation link, then accepts a club invitation.
    const victimSession = await confirm(res.email);
    expect(victimSession).not.toBeNull();
    const inviteToken = await inviteToClub(res.email);
    const accepted = await acceptInvitation({
      token: inviteToken,
      signedInUser: { id: res.userId, email: res.email },
    });
    expect(accepted.organisationId).toBe(club.id);

    // The planted password and session are gone; the victim's session stands.
    await expect(signIn(res.email, ATTACKER_PASSWORD)).rejects.toThrow();
    expect(await sessionFor(planted.token)).toBeNull();
    expect(await hasPassword(res.userId)).toBe(false);
    expect((await sessionFor(victimSession!))?.userId).toBe(res.userId);
    expect(
      await rawDb.auditLog.count({
        where: { action: "auth.unproven_access_revoked", actorUserId: res.userId },
      }),
    ).toBe(1);
  });

  it("refuses an invitation for a signed-in user whose email is not verified, and keeps it usable", async () => {
    const res = await register("unproven");
    const inviteToken = await inviteToClub(res.email);
    await expect(
      acceptInvitation({ token: inviteToken, signedInUser: { id: res.userId, email: res.email } }),
    ).rejects.toMatchObject({ code: "email_unconfirmed" });
    expect(
      await rawDb.membership.count({ where: { userId: res.userId, organisationId: club.id } }),
    ).toBe(0);
    const invitation = await rawDb.invitation.findFirstOrThrow({
      where: { email: res.email, organisationId: club.id },
    });
    expect(invitation.acceptedAt).toBeNull();
  });
});
