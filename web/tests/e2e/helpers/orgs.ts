import { expect, type Browser, type Page } from "@playwright/test";

// Organisation helpers shared by the C01 and D02 specs: invitations through the
// members page, accepting one as a new user, and switching organisation.

export const LAB = "Wideline Lab";
export const DEMO = "Wideline Demo FC";
export const PASSWORD = "e2e-password-0123";

export const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const mail = (local: string) => `${local}@e2e.wideline.localhost`;

/** As the seeded admin, makes the named organisation active through /organisations. */
export async function switchTo(page: Page, name: string) {
  await page.goto("/organisations");
  const current = page.getByRole("main").getByRole("listitem").filter({ hasText: name });
  if ((await current.getAttribute("aria-current")) === "true") return;
  await page.getByRole("button", { name: `Switch to ${name}`, exact: true }).click();
  await expect(page).not.toHaveURL(/\/organisations/);
}

/** Opens an invitation link signed out, creates the account and joins. */
export async function acceptAsNewUser(browser: Browser, path: string, name: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(path);
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account and join" }).click();
  await expect(page).not.toHaveURL(/\/invite\//);
  return page;
}

/** Sends an invitation from the members page (the page must already be open). */
export async function invite(page: Page, email: string, role: string) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Role", { exact: true }).selectOption(role);
  await page.getByRole("button", { name: "Send invitation", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: email })).toBeVisible();
}
