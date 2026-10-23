import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { requireAdminPassword, signInAsAdmin } from "./helpers/auth";
import { databaseUrl, sql } from "./helpers/db";
import { findInviteEmail } from "./helpers/mailpit";

// C01: apply, approve, accept and invite through Mailpit; switching
// organisation; axe on every C01 screen at 375, 768 and 1280 px.

const WIDTHS = [375, 768, 1280];
const LAB = "Wideline Lab";
const DEMO = "Wideline Demo FC";
const PASSWORD = "e2e-password-0123";

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const mail = (local: string) => `${local}@e2e.wideline.localhost`;

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations, page.url()).toEqual([]);
}

/** Presses Tab until the locator has focus, then checks the focus ring is drawn. */
async function expectKeyboardFocusRing(page: Page, target: Locator) {
  const focused = () => target.evaluate((el) => el === document.activeElement);
  for (let i = 0; i < 60 && !(await focused()); i++) await page.keyboard.press("Tab");
  expect(await focused()).toBe(true);
  const outline = await target.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).toBe("solid");
}

/** As the seeded admin, makes the named organisation active through /organisations. */
async function switchTo(page: Page, name: string) {
  await page.goto("/organisations");
  const current = page.getByRole("listitem").filter({ hasText: name });
  if ((await current.getAttribute("aria-current")) === "true") return;
  await page.getByRole("button", { name: `Switch to ${name}` }).click();
  await expect(page).not.toHaveURL(/\/organisations/);
}

/** Opens an invitation link signed out, creates the account and joins. */
async function acceptAsNewUser(browser: Browser, path: string, name: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(path);
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account and join" }).click();
  await expect(page).not.toHaveURL(/\/invite\//);
  return page;
}

async function invite(page: Page, email: string, role: string) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Role", { exact: true }).selectOption(role);
  await page.getByRole("button", { name: "Send invitation", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: email })).toBeVisible();
}

test("apply, approve, accept and invite, end to end", async ({ browser }) => {
  requireAdminPassword();
  test.setTimeout(120_000);
  const tag = unique();
  const orgName = `E2E Academy ${tag}`;
  const applicant = mail(`owner-${tag}`);

  // 1. Apply.
  const visitor = await browser.newContext();
  const apply = await visitor.newPage();
  await apply.goto("/apply");
  await apply.getByLabel("Organisation name").fill(orgName);
  await apply.getByRole("radio", { name: "Academy" }).check();
  await apply.getByLabel("Province or region (optional)").fill("Gauteng");
  await apply.getByLabel("Your name").fill("Thandi Mokoena");
  await apply.getByLabel("Your email").fill(applicant);
  await apply.getByRole("button", { name: "Send application" }).click();
  await expect(apply.getByRole("heading", { level: 1, name: "Application sent" })).toBeFocused();

  // 2. The seeded platform admin approves it.
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signInAsAdmin(admin, "/admin/organisations");
  await expect(
    admin.getByRole("heading", { level: 1, name: "Organisation applications" }),
  ).toBeVisible();
  const row = admin.getByRole("row").filter({ hasText: orgName });
  await expect(row.getByText("Pending")).toBeVisible();
  await row.getByRole("button", { name: `Approve ${orgName}` }).click();
  await expect(admin.getByRole("status")).toContainText(
    `Approved ${orgName}. We emailed an owner invitation to ${applicant}.`,
  );

  // 3. The owner invitation arrives.
  const ownerMail = await findInviteEmail(visitor, applicant);
  expect(ownerMail.subject).toBe(`${orgName} is approved for the Wideline pilot`);

  // 4. The applicant creates an account and lands in the new organisation.
  const owner = await acceptAsNewUser(browser, ownerMail.path, "Thandi Mokoena");
  await expect(owner).toHaveURL(/\/settings\/members/);
  await expect(owner.getByTestId("active-organisation")).toHaveText(orgName);

  // 5. The owner invites a coach; the row shows a Pending chip.
  const coachEmail = mail(`coach-${tag}`);
  await invite(owner, coachEmail, "coach");
  await expect(
    owner.getByRole("row").filter({ hasText: coachEmail }).getByText("Pending"),
  ).toBeVisible();

  // 6. The coach accepts in another browser.
  const coachMail = await findInviteEmail(visitor, coachEmail);
  expect(coachMail.subject).toBe(`Thandi Mokoena invited you to ${orgName} on Wideline`);
  const coach = await acceptAsNewUser(browser, coachMail.path, "Chris Coach");
  await expect(coach).toHaveURL(/\/organisations/);
  await expect(coach.getByTestId("active-organisation")).toHaveText(orgName);

  // 7. A coach cannot open the members page.
  await coach.goto("/settings/members");
  await expect(coach).toHaveURL(/\/forbidden/);

  // The coach is now a member row on the owner's page.
  await owner.reload();
  await expect(owner.getByRole("row").filter({ hasText: "Chris Coach" })).toContainText("Coach");

  // 8. The owner revokes a second invitation; its link then shows the revoked state.
  const scoutEmail = mail(`scout-${tag}`);
  await invite(owner, scoutEmail, "scout");
  const scoutMail = await findInviteEmail(visitor, scoutEmail);
  await owner.getByRole("button", { name: `Revoke invitation to ${scoutEmail}` }).click();
  const dialog = owner.getByRole("dialog", { name: `Revoke the invitation to ${scoutEmail}?` });
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Revoke invitation" }).click();
  await expect(
    owner.getByRole("status").filter({ hasText: `Invitation to ${scoutEmail} revoked.` }),
  ).toBeVisible();
  await expect(owner.getByRole("row").filter({ hasText: scoutEmail })).toHaveCount(0);

  const stranger = await (await browser.newContext()).newPage();
  await stranger.goto(scoutMail.path);
  await expect(
    stranger.getByRole("heading", { level: 1, name: "This invitation was cancelled" }),
  ).toBeVisible();
});

test("the seeded admin switches between organisations", async ({ page }) => {
  requireAdminPassword();
  await signInAsAdmin(page, "/organisations");
  await switchTo(page, LAB);
  await page.goto("/organisations");
  await expect(page.getByTestId("active-organisation")).toHaveText(LAB);
  await expect(page.getByRole("listitem").filter({ hasText: LAB })).toHaveAttribute(
    "aria-current",
    "true",
  );

  await page.getByRole("button", { name: `Switch to ${DEMO}` }).click();
  await expect(page).toHaveURL(/\/settings\/members/);
  await expect(page.getByTestId("active-organisation")).toHaveText(DEMO);

  await page.goto("/organisations");
  await page.getByRole("button", { name: `Switch to ${LAB}` }).click();
  await expect(page).toHaveURL(/\/lab\/matches/);
});

test("an expired invitation cannot be accepted", async ({ page, browser }) => {
  requireAdminPassword();
  test.skip(!databaseUrl, "Set E2E_DATABASE_URL to expire an invitation directly");
  const email = mail(`expired-${unique()}`);
  await signInAsAdmin(page, "/organisations");
  await switchTo(page, DEMO);
  await page.goto("/settings/members");
  await invite(page, email, "scout");
  const { path } = await findInviteEmail(page.context(), email);
  await sql(`UPDATE "Invitation" SET "expiresAt" = now() - interval '1 day' WHERE email = $1`, [
    email,
  ]);

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(path);
  await expect(
    visitor.getByRole("heading", { level: 1, name: "This invitation has expired" }),
  ).toBeVisible();
  await expect(visitor.getByRole("button", { name: "Create account and join" })).toHaveCount(0);
});

test.describe("accessibility", () => {
  for (const width of WIDTHS) {
    test(`C01 screens at ${width}px have no axe violations`, async ({ page, browser }) => {
      requireAdminPassword();
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 900 });

      // Public pages, signed out.
      const visitor = await browser.newContext({ viewport: { width, height: 900 } });
      const pub = await visitor.newPage();
      await pub.goto("/apply");
      await expect(pub.getByRole("heading", { level: 1, name: "Join the pilot" })).toBeVisible();
      await expectNoAxeViolations(pub);

      await signInAsAdmin(page, "/organisations");
      await switchTo(page, LAB);
      for (const path of [
        "/organisations",
        "/admin/organisations",
        "/admin/organisations?status=decided",
      ]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoAxeViolations(page);
      }

      await switchTo(page, DEMO);
      for (const path of ["/settings/organisation", "/settings/members"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoAxeViolations(page);
      }

      // The new-user state of the accept page.
      const email = mail(`axe-${width}-${unique()}`);
      await invite(page, email, "guardian");
      const { path } = await findInviteEmail(visitor, email);
      await pub.goto(path);
      await expect(pub.getByRole("button", { name: "Create account and join" })).toBeVisible();
      await expectNoAxeViolations(pub);

      // A dialog open is part of the screen too.
      await page.getByRole("button", { name: `Revoke invitation to ${email}` }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectNoAxeViolations(page);
      await page.getByRole("dialog").getByRole("button", { name: "Revoke invitation" }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
    });
  }
});

test.describe("keyboard focus", () => {
  test("the invite form and the approval buttons show the focus ring", async ({ page }) => {
    requireAdminPassword();
    await signInAsAdmin(page, "/organisations");
    await switchTo(page, DEMO);
    await page.goto("/settings/members");
    await page.getByRole("heading", { level: 1, name: "Members" }).click();
    for (const target of [
      page.getByLabel("Email", { exact: true }),
      page.getByLabel("Name (optional)"),
      page.getByLabel("Role", { exact: true }),
      page.getByRole("button", { name: "Send invitation", exact: true }),
    ]) {
      await expectKeyboardFocusRing(page, target);
    }

    // Approve and Reject need a pending application.
    const name = `E2E Focus ${unique()}`;
    const visitor = await page.context().browser()!.newContext();
    const apply = await visitor.newPage();
    await apply.goto("/apply");
    await apply.getByLabel("Organisation name").fill(name);
    await apply.getByRole("radio", { name: "Club" }).check();
    await apply.getByLabel("Your name").fill("Focus Tester");
    await apply.getByLabel("Your email").fill(mail(`focus-${unique()}`));
    await apply.getByRole("button", { name: "Send application" }).click();
    await expect(apply.getByRole("heading", { name: "Application sent" })).toBeVisible();

    await switchTo(page, LAB);
    await page.goto("/admin/organisations");
    await page.getByRole("heading", { level: 1 }).click();
    const approve = page.getByRole("button", { name: `Approve ${name}` });
    const reject = page.getByRole("button", { name: `Reject ${name}` });
    await expectKeyboardFocusRing(page, approve);
    await expectKeyboardFocusRing(page, reject);

    // Reject from the keyboard: the dialog opens on its field, Escape returns focus.
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: `Reject ${name}?` });
    await expect(dialog.getByLabel("Reason (optional)")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(reject).toBeFocused();

    await reject.click();
    await dialog.getByLabel("Reason (optional)").fill("E2E test application.");
    await dialog.getByRole("button", { name: "Reject application" }).click();
    await expect(page.getByRole("status")).toContainText(`Rejected ${name}.`);
  });
});
