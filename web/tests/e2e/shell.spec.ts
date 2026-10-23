import { expect, test, type Page } from "@playwright/test";
import { expectKeyboardFocusRing, expectNoAxeViolations } from "./helpers/a11y";
import { requireAdminPassword, signInAsAdmin } from "./helpers/auth";
import { findInviteEmail } from "./helpers/mailpit";
import { acceptAsNewUser, DEMO, invite, LAB, mail, switchTo, unique } from "./helpers/orgs";

// D02 app shell: the layout at 375, 768 and 1280 px (NFR24), keyboard and focus
// (NFR23), the org switcher (AUTH05), and nav by role. The seeded admin is
// platform_admin in Wideline Lab and owner in Wideline Demo FC.

const mainNav = (page: Page) => page.getByRole("navigation", { name: "Main" });

/** The visible labels of the visible Main nav, in order. innerText skips the hidden label span. */
async function navLabels(page: Page) {
  return (await mainNav(page).getByRole("link").allInnerTexts()).map((t) => t.trim());
}

test.describe("layout per width", () => {
  test.beforeEach(async ({ page }) => {
    requireAdminPassword();
    await signInAsAdmin(page, "/organisations");
    await switchTo(page, LAB);
    await page.goto("/lab/matches");
    await expect(page.getByRole("heading", { level: 1, name: "Matches" })).toBeVisible();
  });

  test("1280: the full sidebar with Admin and Lab", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const sidebar = page.getByRole("complementary", { name: "Sidebar" });
    await expect(sidebar).toBeVisible();
    expect((await sidebar.boundingBox())!.width).toBe(240);
    await expect(mainNav(page)).toHaveCount(1);
    expect(await navLabels(page)).toEqual(["Admin", "Lab"]);
    await expect(page.getByRole("link", { name: "Lab" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("768: the rail, with a visible label under each icon", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    const sidebar = page.getByRole("complementary", { name: "Sidebar" });
    await expect(sidebar).toBeVisible();
    expect((await sidebar.boundingBox())!.width).toBe(96);
    await expect(mainNav(page)).toHaveCount(1);
    expect(await navLabels(page)).toEqual(["Admin", "Lab"]);
    await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("375: the top bar and the bottom tab bar, no sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(page.getByRole("complementary", { name: "Sidebar" })).toBeHidden();
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(mainNav(page)).toHaveCount(1);
    await expect(mainNav(page)).toHaveClass(/wl-tabbar/);
    expect(await navLabels(page)).toEqual(["Admin", "Lab"]);
    for (const link of await mainNav(page).getByRole("link").all()) {
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await expectNoAxeViolations(page);
  });

  test("375: the account popover opens and shows Sign out", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const account = page.getByRole("button", { name: "Account" });
    await account.click();
    await expect(account).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("region", { name: "Account" })).toContainText("Lab Admin");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.keyboard.press("Escape");
    await expect(account).toBeFocused();
  });
});

test.describe("keyboard and the org switcher", () => {
  test.beforeEach(async ({ page }) => {
    requireAdminPassword();
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInAsAdmin(page, "/organisations");
    await switchTo(page, LAB);
    await page.goto("/lab/matches");
    await expect(page.getByRole("heading", { level: 1, name: "Matches" })).toBeVisible();
  });

  test("Tab goes skip link, wordmark, switcher, then each nav link, with a ring", async ({
    page,
  }) => {
    const order = [
      page.getByRole("link", { name: "Skip to content" }),
      page.getByRole("link", { name: "Wideline", exact: true }),
      page.getByRole("button", { name: `Organisation: ${LAB}. Switch organisation` }),
      mainNav(page).getByRole("link", { name: "Admin" }),
      mainNav(page).getByRole("link", { name: "Lab" }),
    ];
    for (const target of order) {
      await page.keyboard.press("Tab");
      await expect(target).toBeFocused();
      expect(await target.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
    }
    // The skip link moves focus to main.
    await page.goto("/lab/matches");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  });

  test("Enter opens the switcher, Escape closes it and returns focus", async ({ page }) => {
    const trigger = page.getByRole("button", { name: `Organisation: ${LAB}. Switch organisation` });
    await expectKeyboardFocusRing(page, trigger);
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const panel = page.getByRole("region", { name: "Your organisations" });
    await expect(panel.getByRole("listitem").filter({ hasText: LAB })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(
      panel.getByRole("button", { name: new RegExp(`^Switch to ${DEMO}`) }),
    ).toBeFocused();
    await expectNoAxeViolations(page);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("switching through the shell changes the nav and the active organisation", async ({
    page,
  }) => {
    await page.getByRole("button", { name: `Organisation: ${LAB}. Switch organisation` }).click();
    await page.getByRole("button", { name: new RegExp(`^Switch to ${DEMO}`) }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId("active-organisation")).toHaveText(DEMO);
    expect(await navLabels(page)).toEqual(["Dashboard", "Squad", "Matches", "Settings"]);
    await expect(mainNav(page).getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await page.getByRole("button", { name: `Organisation: ${DEMO}. Switch organisation` }).click();
    await page.getByRole("button", { name: new RegExp(`^Switch to ${LAB}`) }).click();
    await expect(page).toHaveURL(/\/lab\/matches$/);
    expect(await navLabels(page)).toEqual(["Admin", "Lab"]);
  });
});

test("signed out, a shell page redirects to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
});

test("each role sees only its nav items, and the server still guards the pages", async ({
  page,
  browser,
}) => {
  requireAdminPassword();
  test.setTimeout(120_000);
  const tag = unique();
  await signInAsAdmin(page, "/organisations");
  await switchTo(page, DEMO);
  await page.goto("/settings/members");
  const coachEmail = mail(`shell-coach-${tag}`);
  const scoutEmail = mail(`shell-scout-${tag}`);
  await invite(page, coachEmail, "coach");
  await invite(page, scoutEmail, "scout");

  const coach = await acceptAsNewUser(
    browser,
    (await findInviteEmail(page.context(), coachEmail)).path,
    "Shell Coach",
  );
  await expect(coach).toHaveURL(/\/dashboard$/);
  expect(await navLabels(coach)).toEqual(["Dashboard", "Squad", "Matches"]);
  await expect(mainNav(coach).getByRole("link", { name: "Dashboard" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await coach.goto("/settings/members");
  await expect(coach).toHaveURL(/\/forbidden$/);
  await expect(coach.getByRole("heading", { level: 1, name: "No access" })).toBeVisible();
  expect(await navLabels(coach)).toEqual(["Dashboard", "Squad", "Matches"]);
  await expect(coach.getByRole("link", { name: "Go to your home page" })).toHaveAttribute(
    "href",
    "/dashboard",
  );

  const scout = await acceptAsNewUser(
    browser,
    (await findInviteEmail(page.context(), scoutEmail)).path,
    "Shell Scout",
  );
  // C02: a club-invited scout has no scout profile, so /review sends them to /scout.
  await expect(scout).toHaveURL(/\/scout\?from=review$/);
  await expect(scout.getByRole("heading", { name: "No scout profile yet" })).toBeVisible();
  expect(await navLabels(scout)).toEqual(["Review queue", "Shortlists", "Scout profile"]);
  await scout.goto("/dashboard");
  await expect(scout).toHaveURL(/\/forbidden$/);
  await expect(scout.getByRole("heading", { level: 1, name: "No access" })).toBeVisible();

  for (const p of [coach, scout]) {
    for (const width of [375, 768, 1280]) {
      await p.setViewportSize({ width, height: 900 });
      await expect(mainNav(p)).toHaveCount(1);
      await expectNoAxeViolations(p);
    }
  }
});
