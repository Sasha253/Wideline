import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { audit } from "../audit";
import { rawDb } from "../db/raw";
import { env } from "../env";
import { log } from "../log";
import { sendMail } from "../mail";

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
    },
    // Invite-only (AUTH-04, ADMIN-01): nobody can create an account by signing
    // in. Users are created by invitation or by the seed script.
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
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
      nextCookies(),
    ],
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            await audit({
              organisationId: null,
              actorUserId: session.userId,
              action: "auth.login",
              targetType: "Session",
              targetId: session.id,
              metadata: {
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
