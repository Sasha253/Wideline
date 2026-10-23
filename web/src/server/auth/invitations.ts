import "server-only";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { headers } from "next/headers";
import type { Role } from "@/generated/prisma/enums";
import { audit } from "../audit";
import { rawDb } from "../db/raw";
import { hashInvitationToken } from "../organisations/tokens";
import { auth } from "./auth";

/**
 * Invitations, accept side (AUTH-04). Uses the raw client because the invitee
 * is not a member of the organisation yet: the token is the capability. Only a
 * sha256 hash of the token is stored, so the lookup hashes it first.
 */

export type InvitationState = "pending" | "expired" | "revoked" | "used" | "org_inactive";

export type InvitationView = {
  organisationId: string;
  orgName: string;
  role: Role;
  email: string;
  inviteeName: string | null;
  inviterName: string | null;
  expiresAt: Date;
  state: InvitationState;
  /** A Wideline account already exists for the invitation email. */
  userExists: boolean;
  /**
   * Wideline staff sent it from outside the organisation: the owner invitation
   * of an approved application. Only a platform admin can send a new one.
   */
  fromPlatform: boolean;
};

export type InvitationErrorCode =
  | "not_found"
  | "expired"
  | "revoked"
  | "used"
  | "org_inactive"
  | "wrong_account"
  | "account_exists"
  | "email_unconfirmed";

export class InvitationError extends Error {
  constructor(readonly code: InvitationErrorCode) {
    super(`Invitation cannot be accepted: ${code}`);
    this.name = "InvitationError";
  }
}

function stateOf(
  inv: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  orgStatus: string,
  now: Date,
): InvitationState {
  if (inv.acceptedAt) return "used";
  if (inv.revokedAt) return "revoked";
  if (orgStatus !== "active") return "org_inactive";
  if (inv.expiresAt.getTime() <= now.getTime()) return "expired";
  return "pending";
}

async function userByEmail(email: string, db: Pick<typeof rawDb, "user"> = rawDb) {
  return db.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
}

/** The invitation behind a token, for the accept page, or null for an unknown token. */
export async function findInvitationByToken(token: string): Promise<InvitationView | null> {
  if (!token) return null;
  const inv = await rawDb.invitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    include: {
      organisation: { select: { name: true, status: true } },
      invitedBy: { select: { name: true } },
    },
  });
  if (!inv) return null;
  const inviterRoles = inv.invitedById
    ? await rawDb.membership.findMany({
        where: { userId: inv.invitedById },
        select: { organisationId: true, role: true },
      })
    : [];
  const fromPlatform =
    inviterRoles.some((m) => m.role === "platform_admin") &&
    !inviterRoles.some((m) => m.organisationId === inv.organisationId);
  return {
    organisationId: inv.organisationId,
    orgName: inv.organisation.name,
    role: inv.role,
    email: inv.email,
    inviteeName: inv.inviteeName,
    inviterName: inv.invitedBy?.name ?? null,
    expiresAt: inv.expiresAt,
    state: stateOf(inv, inv.organisation.status, new Date()),
    userExists: Boolean(await userByEmail(inv.email)),
    fromPlatform,
  };
}

export type AcceptedInvitation = {
  organisationId: string;
  userId: string;
  email: string;
  createdUser: boolean;
};

/**
 * Accepts an invitation in one transaction. Either a signed-in user whose email
 * matches the invitation, or a new account (name and password) for an email
 * with no account yet. The invitation is claimed with a conditional update
 * that must change exactly one row, so an expired, revoked or used invitation,
 * or one into an organisation that is not active, can never be accepted, and
 * two concurrent accepts give one membership.
 *
 * A signed-in user must have a verified email. Every sign-in path verifies it
 * (magic link, confirmation link) or needs it verified (password), so this is
 * a backstop: an unproven account may hold access its typist planted, and an
 * organisation's data must never join it.
 */
export async function acceptInvitation({
  token,
  signedInUser,
  newUser,
}: {
  token: string;
  signedInUser?: { id: string; email: string };
  newUser?: { name: string; password: string };
}): Promise<AcceptedInvitation> {
  const tokenHash = hashInvitationToken(token);
  const now = new Date();

  const result = await rawDb.$transaction(async (tx) => {
    const inv = await tx.invitation.findUnique({ where: { tokenHash } });
    if (!inv) throw new InvitationError("not_found");
    if (signedInUser && signedInUser.email.toLowerCase() !== inv.email.toLowerCase()) {
      throw new InvitationError("wrong_account");
    }
    if (!signedInUser && !newUser) throw new InvitationError("account_exists");
    if (signedInUser) {
      const user = await tx.user.findUnique({
        where: { id: signedInUser.id },
        select: { emailVerified: true },
      });
      if (!user?.emailVerified) throw new InvitationError("email_unconfirmed");
    }

    // Claim the invitation first: a concurrent accept waits on this row lock
    // and then matches nothing.
    const { count } = await tx.invitation.updateMany({
      where: {
        tokenHash,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
        organisation: { status: "active" },
      },
      data: { acceptedAt: now },
    });
    if (count !== 1) {
      const fresh = await tx.invitation.findUnique({
        where: { tokenHash },
        include: { organisation: { select: { status: true } } },
      });
      const state = fresh ? stateOf(fresh, fresh.organisation.status, now) : "used";
      throw new InvitationError(state === "pending" ? "used" : state);
    }

    let userId: string;
    let createdUser = false;
    if (signedInUser) {
      userId = signedInUser.id;
    } else {
      if (await userByEmail(inv.email, tx)) throw new InvitationError("account_exists");
      // Written directly, as in prisma/seed.ts, because sign-up is disabled.
      // The email is verified: the token arrived by email.
      const user = await tx.user.create({
        data: {
          id: randomUUID(),
          email: inv.email,
          name: newUser!.name,
          emailVerified: true,
        },
      });
      await tx.account.create({
        data: {
          id: randomUUID(),
          accountId: user.id,
          providerId: "credential",
          userId: user.id,
          password: await hashPassword(newUser!.password),
        },
      });
      userId = user.id;
      createdUser = true;
    }

    await tx.invitation.update({ where: { id: inv.id }, data: { acceptedByUserId: userId } });
    const membership = await tx.membership.upsert({
      where: {
        organisationId_userId_role: {
          organisationId: inv.organisationId,
          userId,
          role: inv.role,
        },
      },
      // An existing unaccepted row for this role is accepted now, so the spent
      // token always grants access.
      update: { acceptedAt: now, invitedById: inv.invitedById },
      create: {
        organisationId: inv.organisationId,
        userId,
        role: inv.role,
        invitedById: inv.invitedById,
        acceptedAt: now,
      },
    });
    return { inv, userId, createdUser, membershipId: membership.id };
  });

  const { inv, userId, createdUser, membershipId } = result;
  await audit({
    organisationId: inv.organisationId,
    actorUserId: userId,
    action: "invitation.accepted",
    targetType: "Invitation",
    targetId: inv.id,
    metadata: { email: inv.email, role: inv.role, createdUser },
  });
  await audit({
    organisationId: inv.organisationId,
    actorUserId: userId,
    action: "membership.created",
    targetType: "Membership",
    targetId: membershipId,
    metadata: { userId, role: inv.role, invitedById: inv.invitedById },
  });

  return { organisationId: inv.organisationId, userId, email: inv.email, createdUser };
}

/**
 * Signs a newly created member in (nextCookies sets the session cookie from a
 * server action) and makes the invitation's organisation active on the new
 * session.
 */
export async function signInNewMember({
  email,
  password,
  organisationId,
}: {
  email: string;
  password: string;
  organisationId: string;
}): Promise<void> {
  const res = await auth().api.signInEmail({
    body: { email, password },
    headers: await headers(),
  });
  await rawDb.session.updateMany({
    where: { token: res.token, userId: res.user.id },
    data: { activeOrganisationId: organisationId },
  });
}
