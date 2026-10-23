import { expect, test } from "@playwright/test";
import { requireAdminPassword, signInAsAdmin } from "./helpers/auth";

// <html data-theme> follows the system setting, live; ThemeScope forces dark.

test("html follows the system colour scheme, live", async ({ page }) => {
  const html = page.locator("html");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login");
  await expect(html).toHaveAttribute("data-theme", "dark");

  await page.emulateMedia({ colorScheme: "light" });
  await expect(html).toHaveAttribute("data-theme", "light");

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveAttribute("data-theme", "dark");
});

test("starts light under a light system setting", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("the Lab stays dark under a light system setting", async ({ page }) => {
  requireAdminPassword();
  await page.emulateMedia({ colorScheme: "light" });
  await signInAsAdmin(page, "/lab/matches");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.locator('[data-theme="dark"]').getByRole("heading", { level: 1, name: "Matches" }),
  ).toBeVisible();
});
