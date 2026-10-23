import { defineConfig, devices } from "@playwright/test";

// Smoke tests against an already-running app (the compose stack locally, or
// `pnpm start` in CI). Set E2E_BASE_URL to point elsewhere.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  // Locally the dev server and Chromium share Docker's memory; 3+ workers have
  // OOM-killed the web container. CI uses Playwright's default.
  workers: process.env.CI ? undefined : 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // Screenshot baselines are Linux PNGs (`make test-e2e-update` regenerates them), and
  // `make test-e2e` compares them in the same Linux container. A direct run on another OS
  // (macOS dev host) skips only the pixel comparison; every other assertion still runs.
  ignoreSnapshots: !process.env.CI && process.platform !== "linux",
  // Never write baselines as a side effect: a missing one fails. Only
  // `--update-snapshots=all` (make test-e2e-update) writes them.
  updateSnapshots: "none",
  // The dev server compiles routes on first request; with parallel workers that can
  // take longer than the 5 s default.
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" },
  },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://wideline.localhost",
    trace: "retain-on-failure",
    // A fixed system theme keeps the page shell deterministic.
    colorScheme: "light",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
