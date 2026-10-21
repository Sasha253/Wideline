import { expect, test } from "@playwright/test";

// Log in with the seeded admin, then open the matches list.
const email = process.env.E2E_EMAIL ?? "admin@wideline.localhost";
const password = process.env.E2E_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;

test("sign in and see the matches list", async ({ page }) => {
  test.skip(!password, "Set E2E_PASSWORD (or SEED_ADMIN_PASSWORD) to the seeded admin password");

  await page.goto("/lab/matches");
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/lab\/matches/);
  await expect(page.getByRole("heading", { level: 1, name: "Matches" })).toBeVisible();
});
