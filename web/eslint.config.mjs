import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

// The unscoped Prisma client bypasses tenant scoping (NFR-16). Only these
// files may import it; everything else gets a scoped client from the session.
const RAW_DB_ALLOWED = [
  "src/server/db/**",
  "src/server/auth/**",
  "src/server/audit.ts",
  "src/worker/**",
  "src/app/api/jobs/*/callback/**",
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
