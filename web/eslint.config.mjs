import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

// The unscoped Prisma client bypasses tenant scoping (NFR-16). Only these
// files may import it; everything else gets a scoped client from the session.
const RAW_DB_ALLOWED = [
  "src/server/db/**",
  "src/server/auth/**",
  "src/server/audit.ts",
  // Platform operations across tenants (ADMIN01). Every export takes a
  // platform_admin AuthContext and checks it.
  "src/server/platform/**",
  // Scout registration and profiles (AUTH08 to AUTH10): global, scout-owned
  // tables. Every export is either the public registration or takes the
  // caller's own session userId.
  "src/server/scouts/**",
  // Entitlements and the usage meter (BILL01, ADMIN05): every export takes an
  // explicit organisationId and touches only that organisation's rows.
  "src/server/entitlements/**",
  "src/server/usage/meter.ts",
  // Processing jobs (C07): the worker's job rows and the platform-wide
  // timing median. Every write takes an explicit organisationId; the median
  // reads aggregate timings only, no tenant data.
  "src/server/processing/jobs.ts",
  "src/server/processing/timings.ts",
  // C08: CV dispatch, ingest and the watchdog (worker side), the job readiness
  // check, and the platform-admin alert. Every call takes an explicit
  // organisationId; the alert reads platform admins only.
  "src/server/cv/**",
  "src/server/processing/readiness.ts",
  "src/server/processing/alerts.ts",
  "src/worker/**",
  "src/app/api/jobs/*/callback/**",
  // C09: clips (keys, expiry, cutting and favourites; favourites take the
  // clip's organisationId explicitly, since a scout favourites another
  // organisation's clip) and the Lab's tag import and benchmark aggregates,
  // which take the platform admin's AuthContext and filter by its
  // organisationId.
  "src/server/clips/**",
  "src/server/lab/**",
  // C10: the review queue reads across organisations (match-level facts
  // only), and claims are written only here. Every page-facing export takes
  // the caller's ReviewerContext and touches only that scout's claims; C11
  // reads claimed matches through claimScope() (NFR16).
  "src/server/review/**",
  "prisma/seed.ts",
  "scripts/**",
  "tests/**",
];

const config = [
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "src/generated/**",
      "next-env.d.ts",
      "playwright-report/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: RAW_DB_ALLOWED,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/db/raw", "**/server/db/raw", "@/generated/prisma/client"],
              message: "Use the scoped client from requireRole() (NFR-16).",
            },
          ],
        },
      ],
    },
  },
];

export default config;
