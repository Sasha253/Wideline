import { expect, test } from "@playwright/test";
import { requireAdminPassword, signInAsAdmin } from "./helpers/auth";

// Floodlight themes (docs/design-handoff/README.md, rule 6): dark is the default everywhere,
// <html data-theme> holds the stored choice (dark, light or system), and the Lab and review
// workspace stay dark unless the user chose Light.

const KEY = "wideline-theme";

test("dark is the default, whatever the system setting", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("a stored choice applies before first paint and survives a reload", async ({ page }) => {
  await page.goto("/login");
  await page.evaluate((key) => localStorage.setItem(key, "light"), KEY);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.evaluate((key) => localStorage.setItem(key, "system"), KEY);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
});

test("the Lab stays dark under Match system with a light system setting", async ({ page }) => {
  requireAdminPassword();
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/login");
  await page.evaluate((key) => localStorage.setItem(key, "system"), KEY);
  await signInAsAdmin(page, "/lab/matches");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
  await expect(
    page.locator('[data-theme="dark"]').getByRole("heading", { level: 1, name: "Matches" }),
  ).toBeVisible();
});
