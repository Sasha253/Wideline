import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers/a11y";
import { requireAdminPassword, signInAsAdmin } from "./helpers/auth";
import { findEmailLink } from "./helpers/mailpit";
import { mail, PASSWORD, unique } from "./helpers/orgs";

// C02: independent scout registration, email confirmation, admin approval and
// suspension, and review gating; axe on every C02 screen at 375, 768 and 1280 px.
// Registration takes no password: the account opens through the emailed link,
// and the scout sets a password on /scout afterwards.

const WIDTHS = [375, 768, 1280];
const VERIFY_LINK = /https?:\/\/\S+\/api\/auth\/verify-email\?\S+/;

/** Appends the Luhn check digit to 12 digits: a valid South African ID. */
function saId(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    let d = Number(first12[11 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return `${first12}${(10 - (sum % 10)) % 10}`;
}

/** A fresh adult ID (born 1 Jan 1980), so runs never collide on the identity hash. */
const adultId = () => saId(`800101${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`);
/** Born 1 Jan 2015: 13 valid digits that only the server refuses (under 18). */
const childId = () => saId(`150101${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`);

const step = (page: Page, n: number) => page.locator(`#step-${n}`);
const cont = (page: Page, n: number) => step(page, n).getByRole("button", { name: "Continue" });

type Scout = { name: string; email: string; id: string };

function newScout(): Scout {
  const tag = unique();
  return { name: `E2E Scout ${tag}`, email: mail(`scout-${tag}`), id: adultId() };
}

/** Steps 1 to 4 of /register, signed out, leaving the page on step 4, the last. */
async function fillSteps(page: Page, s: Scout, check?: (n: number) => Promise<void>) {
  await check?.(1);
  await step(page, 1).getByLabel("Your name").fill(s.name);
  await step(page, 1).getByLabel("Email").fill(s.email);
  await step(page, 1).getByLabel("Mobile number").fill("082 123 4567");
  await cont(page, 1).click();
  await expect(page.locator("#step-2-title")).toBeFocused();
  await check?.(2);
  await step(page, 2)
    .getByRole("radio", { name: /South African ID/ })
    .check();
  await step(page, 2).getByLabel("ID number").fill(s.id);
  await cont(page, 2).click();
  await expect(page.locator("#step-3-title")).toBeFocused();
  await check?.(3);
  await step(page, 3).getByLabel("Club name").fill("E2E Conflict FC");
  await cont(page, 3).click();
  await expect(page.locator("#step-4-title")).toBeFocused();
  await check?.(4);
  await step(page, 4)
    .getByRole("checkbox", { name: /I am 18 or older/ })
    .check();
}

/** Registers signed out. Nothing signs in: the page says to check the email. */
async function register(page: Page, s: Scout) {
  await page.goto("/register");
  await fillSteps(page, s);
  await step(page, 4).getByRole("button", { name: "Register as a scout" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeFocused();
  await expect(page.getByText(`We sent a link to ${s.email}.`)).toBeVisible();
}

/** Opens the confirmation link from Mailpit, which signs the scout in on /scout. */
async function confirm(page: Page, s: Scout) {
  const { url } = await findEmailLink(
    page.context(),
    s.email,
    "Confirm your email for Wideline",
    VERIFY_LINK,
  );
  await page.goto(url);
  await expect(page).toHaveURL(/\/scout\?registered=1/);
}

/** Registers a new scout in a fresh signed-out context; `confirmed` also opens the link. */
async function registerInNewContext(browser: Browser, { width = 375, confirmed = true } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const s = newScout();
  await register(page, s);
  if (confirmed) await confirm(page, s);
  return { context, page, scout: s };
}

test("register, confirm, approve, review, suspend: end to end", async ({ browser }) => {
  requireAdminPassword();
  test.setTimeout(120_000);

  // 1. Register at 375 through all 4 steps. Nothing signs in yet.
  const {
    context: scoutContext,
    page: scout,
    scout: s,
  } = await registerInNewContext(browser, {
    confirmed: false,
  });
  await scout.goto("/scout");
  await expect(scout).toHaveURL(/\/login/);

  // 2. Confirm the email through the link Mailpit caught: it signs the scout in.
  await confirm(scout, s);
  await expect(scout.getByText("Awaiting approval")).toBeVisible();
  await expect(
    scout.getByRole("status").filter({ hasText: "Registration received" }),
  ).toBeVisible();
  await expect(scout.getByText("Confirmed", { exact: true })).toBeVisible();

  // 3. No review access yet: /review sends a pending scout to /scout.
  await scout.goto("/review");
  await expect(scout).toHaveURL(/\/scout\?from=review/);
  await expect(
    scout.getByText(/The review queue opens once your scout profile is approved/),
  ).toBeVisible();

  // 4. The scout sets a password, then signs in with it in a fresh context.
  await scout.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await scout.getByRole("button", { name: "Set password" }).click();
  await expect(
    scout.getByRole("region", { name: "Set a password" }).getByRole("status"),
  ).toContainText("Password set.");
  const passwordContext = await browser.newContext();
  const passwordPage = await passwordContext.newPage();
  await passwordPage.goto("/login?next=/scout");
  await passwordPage.getByLabel("Email").fill(s.email);
  await passwordPage.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await passwordPage.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(passwordPage).toHaveURL(/\/scout/);
  await expect(passwordPage.getByRole("heading", { name: "Set a password" })).toHaveCount(0);
  await passwordContext.close();

  // 5. The platform admin approves.
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signInAsAdmin(admin, "/admin/scouts");
  await expect(admin.getByRole("heading", { level: 1, name: "Scout registrations" })).toBeVisible();
  const row = admin.getByRole("row").filter({ hasText: s.email });
  await expect(row.getByText("Email confirmed")).toBeVisible();
  await expect(row).not.toContainText(s.id);
  await row.getByRole("button", { name: `Approve ${s.name}` }).click();
  await expect(admin.getByRole("status")).toContainText(
    `Approved ${s.name}. We emailed them a link to the review queue.`,
  );

  // 6. The scout reaches the review queue.
  await scout.goto("/review");
  await expect(scout.getByRole("heading", { level: 1, name: "Review queue" })).toBeVisible();
  await scout.goto("/scout");
  await expect(scout.getByRole("heading", { name: "You can review matches" })).toBeVisible();
  for (const width of WIDTHS) {
    await scout.setViewportSize({ width, height: 900 });
    await expectNoAxeViolations(scout);
  }

  // 7. The admin suspends; /review redirects again and /scout shows the reason.
  await admin.goto("/admin/scouts?status=approved");
  await admin
    .getByRole("row")
    .filter({ hasText: s.email })
    .getByRole("button", { name: `Suspend ${s.name}` })
    .click();
  const dialog = admin.getByRole("dialog", { name: `Suspend ${s.name}?` });
  await dialog.getByRole("button", { name: "Suspend scout" }).click();
  await expect(dialog.getByText("Enter a reason for the suspension.")).toBeVisible();
  await dialog.getByLabel("Reason").fill("Shared footage outside Wideline");
  await dialog.getByRole("button", { name: "Suspend scout" }).click();
  await expect(admin.getByRole("status")).toContainText(`Suspended ${s.name}.`);

  await scout.goto("/review");
  await expect(scout).toHaveURL(/\/scout\?from=review/);
  await expect(
    scout.getByRole("heading", { name: "Your review access is suspended" }),
  ).toBeVisible();
  await expect(scout.getByText("Reason: Shared footage outside Wideline")).toBeVisible();

  await scoutContext.close();
  await adminContext.close();
});

test("Back and Continue keep values; a server field error jumps to its step", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/register");
  await expect(page).toHaveTitle("Register as a scout · Wideline");

  // A client check stays on the step and focuses the first invalid field.
  await cont(page, 1).click();
  await expect(step(page, 1).getByLabel("Your name")).toBeFocused();
  await expect(step(page, 1).getByText("Enter your name.")).toBeVisible();

  const s = newScout();
  await step(page, 1).getByLabel("Your name").fill(s.name);
  await step(page, 1).getByLabel("Email").fill(s.email);
  await step(page, 1).getByLabel("Mobile number").fill("+44 7700 900123");
  await cont(page, 1).click();
  await expect(page.locator("#step-2-title")).toBeFocused();
  await expect(page).toHaveTitle("Your identity · Register as a scout · Wideline");

  await step(page, 2)
    .getByRole("radio", { name: /Passport/ })
    .check();
  await step(page, 2).getByLabel("Passport number").fill("A1234567");
  await step(page, 2).getByLabel("Country that issued your passport").selectOption("GB");
  await cont(page, 2).click();
  await step(page, 3).getByRole("button", { name: "Back" }).click();
  await expect(page.locator("#step-2-title")).toBeFocused();
  await expect(step(page, 2).getByLabel("Passport number")).toHaveValue("A1234567");
  await step(page, 2).getByRole("button", { name: "Back" }).click();
  await expect(step(page, 1).getByLabel("Your name")).toHaveValue(s.name);

  // Switching document clears the number; an under-18 ID passes the client check only.
  await cont(page, 1).click();
  await step(page, 2)
    .getByRole("radio", { name: /South African ID/ })
    .check();
  await expect(step(page, 2).getByLabel("ID number")).toHaveValue("");
  await step(page, 2).getByLabel("ID number").fill(childId());
  await cont(page, 2).click();
  await step(page, 3)
    .getByRole("checkbox", { name: "I have no clubs or players to declare." })
    .check();
  await expect(step(page, 3).getByLabel("Club name")).toBeHidden();
  await cont(page, 3).click();
  await step(page, 4)
    .getByRole("checkbox", { name: /I am 18 or older/ })
    .check();
  await step(page, 4).getByRole("button", { name: "Register as a scout" }).click();

  await expect(step(page, 2)).toBeVisible();
  await expect(step(page, 2).getByRole("alert")).toContainText(
    "Some details need fixing. Check the highlighted fields.",
  );
  await expect(step(page, 2).getByLabel("ID number")).toBeFocused();
  await expect(
    step(page, 2).getByText("You need to be 18 or older to review matches."),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/register/);
});

test("keyboard only at 1280: Enter advances, never submits early", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/register");
  const s = newScout();
  const tabTo = async (locator: ReturnType<Page["locator"]>) => {
    for (let i = 0; i < 40; i++) {
      if (await locator.evaluate((el) => el === document.activeElement)) return;
      await page.keyboard.press("Tab");
    }
    await expect(locator).toBeFocused();
  };

  await tabTo(step(page, 1).getByLabel("Your name"));
  await page.keyboard.type(s.name);
  await page.keyboard.press("Tab");
  await page.keyboard.type(s.email);
  await page.keyboard.press("Tab");
  await page.keyboard.type("0821234567");
  await page.keyboard.press("Enter");
  await expect(page.locator("#step-2-title")).toBeFocused();
  await expect(page).toHaveURL(/\/register$/);

  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await expect(step(page, 2).getByRole("radio", { name: /South African ID/ })).toBeChecked();
  await tabTo(step(page, 2).getByLabel("ID number"));
  await page.keyboard.type(s.id);
  await page.keyboard.press("Enter");
  await expect(page.locator("#step-3-title")).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(step(page, 3).getByLabel("Club name")).toBeFocused();
  await page.keyboard.type("Keyboard FC");
  await page.keyboard.press("Enter");
  await expect(page.locator("#step-4-title")).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(step(page, 4).getByRole("checkbox", { name: /I am 18 or older/ })).toBeFocused();
  await page.keyboard.press("Space");
  await tabTo(step(page, 4).getByRole("button", { name: "Register as a scout" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeFocused();
  await expect(page).toHaveURL(/\/register$/);
});

for (const width of WIDTHS) {
  test(`axe: /register, every step, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/register");
    const s = newScout();
    await fillSteps(page, s, async () => expectNoAxeViolations(page));
    await step(page, 4).getByRole("button", { name: "Register as a scout" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeFocused();
    await expectNoAxeViolations(page);
  });
}

test("axe: /register without JavaScript at 375px, all steps stacked", async ({ browser }) => {
  // The app's scripts are blocked, so the page stays as the server rendered it. Playwright
  // keeps JavaScript on for axe (javaScriptEnabled: false would stop axe too).
  const context = await browser.newContext({ viewport: { width: 375, height: 900 } });
  await context.route("**/_next/static/**/*.js", (route) => route.abort());
  const page = await context.newPage();
  await page.goto("/register");
  for (let n = 1; n <= 4; n++) await expect(step(page, n)).toBeVisible();
  await expect(step(page, 5)).toHaveCount(0);
  await expect(page.getByLabel("Password")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Register as a scout" })).toHaveCount(1);
  await expectNoAxeViolations(page);
  await context.close();
});

test("axe: /scout for a newly confirmed scout, with the password section", async ({ browser }) => {
  const { context, page } = await registerInNewContext(browser);
  await expect(page.getByRole("heading", { name: "Set a password" })).toBeVisible();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoAxeViolations(page);
  }
  // A short password is refused in place, and the field is focused.
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
  await expectNoAxeViolations(page);
  await context.close();
});

test("axe: /admin/scouts with a pending row and an open Reject dialog", async ({
  browser,
  page,
}) => {
  requireAdminPassword();
  test.setTimeout(90_000);
  // Registered but not confirmed: the row shows the email state.
  const { context, scout: s } = await registerInNewContext(browser, { confirmed: false });
  await context.close();
  await signInAsAdmin(page, "/admin/scouts");
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin/scouts");
    await expect(page.getByText(s.email).filter({ visible: true }).first()).toBeVisible();
    await expectNoAxeViolations(page);
    const item =
      width < 768
        ? page.getByRole("listitem").filter({ hasText: s.email })
        : page.getByRole("row").filter({ hasText: s.email });
    // The match control stays usable in the table: the select keeps its minimum width and
    // Save match never covers it (at 768 the table region scrolls sideways instead).
    if (width >= 768) {
      const select = item.getByLabel(`Wideline organisation for E2E Conflict FC`);
      const save = item.getByRole("button", { name: "Save match for E2E Conflict FC" });
      const a = (await select.boundingBox())!;
      const b = (await save.boundingBox())!;
      expect(a.width).toBeGreaterThanOrEqual(144);
      expect(b.x >= a.x + a.width || b.y >= a.y + a.height).toBe(true);
    }
    // Unconfirmed email: Approve is disabled and says why.
    await expect(item.getByRole("button", { name: `Approve ${s.name}` })).toBeDisabled();
    await expect(item.getByText("Approve once their email is confirmed.")).toBeVisible();
    await item.getByRole("button", { name: `Reject ${s.name}` }).click();
    const dialog = page.getByRole("dialog", { name: `Reject ${s.name}?` });
    await expect(dialog.getByLabel("Reason (optional)")).toBeFocused();
    await expectNoAxeViolations(page);
    await dialog.getByRole("button", { name: "Cancel" }).click();
  }
});
