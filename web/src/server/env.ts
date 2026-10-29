import "server-only";
import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: optional,
  SMTP_PASSWORD: optional,
  MAIL_FROM: z.string().default("Wideline <no-reply@wideline.localhost>"),
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_PUBLIC_ENDPOINT: z.url(),
  S3_INTERNAL_ENDPOINT: z.url(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  // C08: the HMAC key for CV worker callbacks (src/server/cv/instances.ts). At
  // least 32 characters in production. The worker side reads the same values
  // through src/server/cv/config.ts.
  CV_CALLBACK_SECRET: z.string().min(8),
  CV_DISPATCH: z.enum(["docker", "hourly"]).default("docker"),
  CV_CALLBACK_BASE_URL: optional,
  SENTRY_DSN: optional,
  // AUTH09: the HMAC key for scout ID and passport numbers
  // (src/server/scouts/identity.ts). Required in production; elsewhere it falls
  // back to a key derived from BETTER_AUTH_SECRET.
  ID_HASH_SECRET: z
    .string()
    .min(32)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

const checked = schema.superRefine((e, ctx) => {
  if (e.NODE_ENV === "production" && !e.ID_HASH_SECRET) {
    ctx.addIssue({
      code: "custom",
      path: ["ID_HASH_SECRET"],
      message: "ID_HASH_SECRET is required in production",
    });
  }
  if (e.NODE_ENV === "production" && e.CV_CALLBACK_SECRET.length < 32) {
    ctx.addIssue({
      code: "custom",
      path: ["CV_CALLBACK_SECRET"],
      message: "CV_CALLBACK_SECRET must be at least 32 characters in production",
    });
  }
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

// Parsed on first use, not at import, so `next build` does not need secrets.
export function env(): Env {
  cached ??= checked.parse(process.env);
  return cached;
}
