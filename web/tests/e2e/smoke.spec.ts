import { expect, test } from "@playwright/test";
import { requireAdminPassword, signInAsAdmin } from "./helpers/auth";

// Log in with the seeded admin, then open the matches list.
test("sign in and see the matches list", async ({ page }) => {
  requireAdminPassword();

  await page.goto("/lab/matches");
  await expect(page).toHaveURL(/\/login/);

  await signInAsAdmin(page);

  await expect(page).toHaveURL(/\/lab\/matches/);
  await expect(page.getByRole("heading", { level: 1, name: "Matches" })).toBeVisible();
});
