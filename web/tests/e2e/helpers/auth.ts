import { expect, test, type Page } from "@playwright/test";

// The seeded platform admin (`make seed` prints the password).
export const adminEmail = process.env.E2E_EMAIL ?? "admin@wideline.localhost";
export const adminPassword = process.env.E2E_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;

/** Skips the current test when no admin password is configured. */
export function requireAdminPassword() {
  test.skip(
    !adminPassword,
    "Set E2E_PASSWORD (or SEED_ADMIN_PASSWORD) to the seeded admin password",
  );
}

/**
 * Signs in as the seeded admin. Call it on the login page (for example after
 * the proxy redirected there), or pass `next` to start from /login.
 */
export async function signInAsAdmin(page: Page, next?: string) {
  if (next) await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
