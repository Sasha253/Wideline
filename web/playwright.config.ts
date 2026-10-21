import { defineConfig, devices } from "@playwright/test";

// Smoke tests against an already-running app (the compose stack locally, or
// `pnpm start` in CI). Set E2E_BASE_URL to point elsewhere.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://wideline.localhost",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
