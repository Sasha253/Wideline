import "server-only";
import { randomUUID } from "node:crypto";
import { audit } from "../audit";
import { rawDb } from "../db/raw";
import { scoutRegisteredEmail } from "../emails/scout";
import { env } from "../env";
import { log } from "../log";
import { sendMail } from "../mail";
import { isUniqueViolation } from "./errors";
import { registrationSchema, type RegistrationInput } from "./fields";
import { hashIdNumber } from "./identity";
import { ensureScoutNetwork, SCOUT_NETWORK_ORG_ID } from "./network";
import { REVIEWER_TERMS_VERSION } from "./terms";

/**
 * Public scout registration (AUTH08, AUTH09, AUTH10). Unauthenticated by
 * design: the caller is either signed out (a new account is created) or the
 * signed-in user registering themselves. Uses the raw client, as the
 * invitation accept path does, because sign-up is off in Better Auth.
 */

export type ScoutRegistrationErrorCode =
  "spam" | "identity_taken" | "account_exists" | "already_registered";

export class ScoutRegistrationError extends Error {
  constructor(readonly code: ScoutRegistrationErrorCode) {
    super(`Scout registration refused: ${code}`);
    this.name = "ScoutRegistrationError";
  }
}

export type RegisteredScout = {
  userId: string;
  profileId: string;
  email: string;
  name: string;
  createdUser: boolean;
  emailSent: boolean;
};

/**
 * Registers a scout in one transaction: the User when signed out, then a
 * pending ScoutProfile with the terms version, the declared
 * affiliations, and an accepted scout Membership in the scout network. The ID
 * number is stored only as hashIdNumber(); idNumberHash is unique, so one
 * identity registers once, even when two requests race. Throws ZodError for
 * invalid input and ScoutRegistrationError for a refusal.
 *
 * A signed-out registration proves nothing about the email, so the new User
 * has emailVerified false, no Account (no password, no OAuth link) and no
 * session. The only way in is a link sent to that mailbox (Better Auth's
 * confirmation email or a magic link); the owner then sets a password on
 * /scout (setOwnPassword). Nobody can register someone else's email and keep
 * a way into the account once its owner starts using it.
 */
export async function registerScout({
  input,
  signedInUser,
}: {
  input: RegistrationInput;
  signedInUser?: { id: string; name: string; email: string };
}): Promise<RegisteredScout> {
  const data = registrationSchema({ newAccount: !signedInUser }).parse(input);
  if (data.website) throw new ScoutRegistrationError("spam");

  const idNumberHash = hashIdNumber(data.document);
  const now = new Date();
  await ensureScoutNetwork();

  let result: {
    userId: string;
    profileId: string;
    email: string;
    name: string;
    createdUser: boolean;
  };
  try {
    result = await rawDb.$transaction(async (tx) => {
      if (signedInUser) {
        const existing = await tx.scoutProfile.findUnique({
          where: { userId: signedInUser.id },
          select: { id: true },
        });
        if (existing) throw new ScoutRegistrationError("already_registered");
      }
      const taken = await tx.scoutProfile.findUnique({
        where: { idNumberHash },
        select: { id: true },
      });
      if (taken) throw new ScoutRegistrationError("identity_taken");

      let userId: string;
      let email: string;
      let name: string;
      let createdUser = false;
      if (signedInUser) {
        ({ id: userId, email, name } = signedInUser);
      } else {
        email = data.email!;
        name = data.name!;
        const exists = await tx.user.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
          select: { id: true },
        });
        if (exists) throw new ScoutRegistrationError("account_exists");
        // Written directly, as in acceptInvitation, because sign-up is disabled.
        // No credential Account: see the function comment.
        const user = await tx.user.create({
          data: { id: randomUUID(), email, name, emailVerified: false },
        });
        userId = user.id;
        createdUser = true;
      }

      const profile = await tx.scoutProfile.create({
        data: {
          userId,
          status: "pending",
          idDocumentType: data.document.type,
          idCountry: data.document.country,
          idNumberHash,
          phone: data.phone,
          termsAcceptedAt: now,
          termsVersion: REVIEWER_TERMS_VERSION,
        },
      });
      if (data.affiliations.length) {
        await tx.scoutAffiliation.createMany({
          data: data.affiliations.map((a) => ({
            scoutUserId: userId,
            type: a.type,
            name: a.name,
            clubName: a.type === "player" ? a.clubName : null,
            declaredAt: now,
          })),
        });
      }
      await tx.membership.upsert({
        where: {
          organisationId_userId_role: {
            organisationId: SCOUT_NETWORK_ORG_ID,
            userId,
            role: "scout",
          },
        },
        update: { acceptedAt: now },
        create: {
          organisationId: SCOUT_NETWORK_ORG_ID,
          userId,
          role: "scout",
          acceptedAt: now,
        },
      });
      return { userId, profileId: profile.id, email, name, createdUser };
    });
  } catch (err) {
    // A concurrent registration won the race for the same identity, email or user.
    if (isUniqueViolation(err, "idNumberHash")) throw new ScoutRegistrationError("identity_taken");
    if (isUniqueViolation(err, "userId")) throw new ScoutRegistrationError("already_registered");
    if (isUniqueViolation(err, "email")) throw new ScoutRegistrationError("account_exists");
    throw err;
  }

  await audit({
    organisationId: null,
    actorUserId: result.userId,
    action: "scout.registered",
    targetType: "ScoutProfile",
    targetId: result.profileId,
    // Never the ID number, nor its hash.
    metadata: {
      idDocumentType: data.document.type,
      idCountry: data.document.country,
      affiliationCount: data.affiliations.length,
      termsVersion: REVIEWER_TERMS_VERSION,
      createdUser: result.createdUser,
    },
  });

  let emailSent = false;
  const { subject, text } = scoutRegisteredEmail({ name: result.name, appUrl: env().APP_URL });
  try {
    await sendMail(result.email, subject, text);
    emailSent = true;
  } catch (err) {
    log.error({ err, userId: result.userId }, "scout registration email failed");
  }

  return { ...result, emailSent };
}
