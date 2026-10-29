// No "server-only" marker: the worker (plain Node, src/worker/) reads this.
import { z } from "zod";

/**
 * CV job settings (C08), parsed from the environment on first use. The web
 * app's env() (src/server/env.ts) checks the secret and the dispatch mode at
 * startup; this is the worker-safe read of the same variables plus the
 * dispatcher's own. NFR07's 10 and 30 minutes are constants in watchdog.ts,
 * not settings.
 */

const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const schema = z.object({
  CV_CALLBACK_SECRET: z.string().min(8),
  CV_DISPATCH: z.enum(["docker", "hourly"]).default("docker"),
  // Where a CV instance reaches the callback route. Locally the web service on
  // the compose network.
  CV_CALLBACK_BASE_URL: z.url().default("http://web:3000"),
  CV_WORKER_IMAGE: z.string().min(1).default("wideline-cv-worker:dev"),
  CV_DOCKER_NETWORK: z.string().min(1).default("wideline_default"),
  DOCKER_SOCKET: z.string().min(1).default("/var/run/docker.sock"),
  // The longest one CV attempt may run before the dispatcher gives up (4 h).
  CV_MAX_JOB_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(4 * 3600),
  // Local Docker costs nothing; the rate exists so the cost path is exercised.
  CV_DOCKER_CENTS_PER_HOUR: z.coerce.number().int().nonnegative().default(0),
  CV_DOCKER_CURRENCY: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("USD"),
  // The hourly GPU provider (PRD open question; providers/hourly.ts).
  HOURLY_GPU_API_URL: optional,
  HOURLY_GPU_API_TOKEN: optional,
  HOURLY_GPU_CENTS_PER_HOUR: z.coerce.number().int().nonnegative().default(0),
  HOURLY_GPU_CURRENCY: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("USD"),
});

export type CvConfig = z.infer<typeof schema>;

let cached: CvConfig | undefined;

export function cvConfig(): CvConfig {
  cached ??= schema.parse(process.env);
  return cached;
}

/** Clears the cached settings, for tests that change the environment. */
export function resetCvConfig(): void {
  cached = undefined;
}
