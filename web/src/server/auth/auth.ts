import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { audit } from "../audit";
import { rawDb } from "../db/raw";
import { verifyEmailEmail } from "../emails/scout";
import { env } from "../env";
import { log } from "../log";
import { sendMail } from "../mail";
import { impersonation } from "./impersonation";
import { revokeUnprovenAccess } from "./password";

function createAuth() {
  const e = env();
  const googleEnabled = Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);

  return betterAuth({
    baseURL: e.BETTER_AUTH_URL,
    secret: e.BETTER_AUTH_SECRET,
    trustedOrigins: [e.APP_URL],
    database: prismaAdapter(rawDb, { provider: "postgresql" }),
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // AUTH05: the active organisation persists per session. Only the server
      // sets it (setActiveOrganisation in ./organisations.ts), never a client.
      additionalFields: {
        activeOrganisationId: { type: "string", required: false, input: false },
      },
    },
    // Invite-only (AUTH-04, ADMIN-01): nobody can create an account by signing
    // in. Users are created by invitation or by the seed script.
    // A password only signs in to an account whose email is proven. Invited
    // and seeded users are verified when created; a self-registered scout has
    // no password until they set one after confirming (setOwnPassword).
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      requireEmailVerification: true,
    },
    // AUTH09: scouts who register confirm their email before a platform admin
    // can approve them. Sent by registerScoutAction and the Resend button on
    // /scout; the link signs them in and lands on /scout.
    emailVerification: {
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      // The first proof of the mailbox. Any account link or session the user
      // gained before it carries no proof that it belongs to the mailbox
      // owner, so it goes, as Better Auth's magic link does for unverified
      // users (revokeUnprovenAccountAccess). Registration creates none, so
      // this is a backstop. Only the first confirmation runs this hook.
      beforeEmailVerification: async (user) => {
        await revokeUnprovenAccess(user.id);
      },
      sendVerificationEmail: async ({ user, url }) => {
        const { subject, text } = verifyEmailEmail({ name: user.name, url });
        await sendMail(user.email, subject, text);
        log.info({ userId: user.id }, "verification email sent");
      },
    },
    socialProviders: googleEnabled
      ? {
          google: {
            clientId: e.GOOGLE_CLIENT_ID!,
            clientSecret: e.GOOGLE_CLIENT_SECRET!,
            disableSignUp: true,
          },
        }
      : {},
    account: {
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    plugins: [
      magicLink({
        disableSignUp: true,
        expiresIn: 60 * 10,
        sendMagicLink: async ({ email, url }) => {
          await sendMail(
            email,
            "Your Wideline sign-in link",
            `Sign in to Wideline:\n\n${url}\n\nThe link works once and expires in 10 minutes. If you did not ask for it, ignore this email.`,
          );
          log.info({ email }, "magic link sent");
        },
      }),
      impersonation(),
      nextCookies(),
    ],
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            // "Log in as" (./impersonation.ts): the platform admin is the actor.
            const impersonatedBy = (session as { impersonatedBy?: string | null }).impersonatedBy;
            await audit({
              organisationId: null,
              actorUserId: impersonatedBy ?? session.userId,
              action: impersonatedBy ? "auth.impersonate.start" : "auth.login",
              targetType: "Session",
              targetId: session.id,
              metadata: {
                ...(impersonatedBy ? { userId: session.userId } : {}),
                ipAddress: session.ipAddress ?? null,
                userAgent: session.userAgent ?? null,
              },
            });
          },
        },
      },
    },
    telemetry: { enabled: false },
  });
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;

// Built on first use so env is read at runtime, not at build time.
export function auth(): Auth {
  instance ??= createAuth();
  return instance;
}

export function googleSignInEnabled(): boolean {
  const e = env();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
}
