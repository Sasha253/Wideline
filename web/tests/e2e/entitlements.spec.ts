import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers/a11y";
import { requireAdminPassword, signInAsAdmin } from "./helpers/auth";
import { DEMO, switchTo } from "./helpers/orgs";

// C03: flags and limits for one organisation (docs/build/design/C03.md). The
// tests share Wideline Demo FC's flags, so they run one after the other, and
// each one puts back what it changed.

test.describe.configure({ mode: "serial" });

const WIDTHS = [375, 768, 1280];
let demoPath = "";

const card = (page: Page, name: string) => page.getByRole("listitem", { name, exact: true });

/** Opens Demo FC's flags and limits from the All tab, at the current width. */
async function openDemo(page: Page) {
  await page.goto("/admin/organisations");
  await page
    .getByRole("navigation", { name: "Organisation list" })
    .getByRole("link", { name: "All" })
    .click();
  await expect(page).toHaveURL(/status=all/);
  const width = page.viewportSize()?.width ?? 1280;
  // The table shows from 768px, the cards below.
  const scope =
    width >= 768
      ? page.getByRole("region", { name: "All organisations, by name" })
      : page.getByRole("main").getByRole("list").last();
  await scope.getByRole("link", { name: DEMO, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: DEMO })).toBeVisible();
  demoPath = new URL(page.url()).pathname;
}

/** Puts Scout search and Matches per month back to the plan, whatever an earlier run left. */
async function resetDemo(page: Page) {
  const flag = card(page, "Scout search");
  await flag.getByRole("radio", { name: /Plan default/ }).check();
  await flag.getByRole("button", { name: "Save Scout search" }).click();
  await expect(flag.getByRole("status")).toBeVisible();
  const limit = card(page, "Matches per month");
  const clear = limit.getByRole("button", { name: "Use plan default for Matches per month" });
  if (await clear.isVisible()) {
    await clear.click();
    await expect(limit.getByRole("status")).toContainText("follows the Pilot plan again");
  }
}

async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const chip = (c: Locator) => c.locator(".wl-chip");

test("set a flag and a limit override, then put both back", async ({ page }) => {
  requireAdminPassword();
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAsAdmin(page, "/admin/organisations");
  await openDemo(page);
  await resetDemo(page);
  await page.reload();

  // Scout search on: a banner, the chip reads On, from a flag.
  const flag = card(page, "Scout search");
  await flag.getByRole("radio", { name: "On", exact: true }).check();
  await flag.getByRole("button", { name: "Save Scout search" }).click();
  await expect(flag.getByRole("status")).toHaveText(`Scout search is on for ${DEMO}.`);
  await expect(chip(flag)).toHaveText("On");
  await expect(flag.getByText("From a flag", { exact: true })).toBeVisible();
  await expect(flag.getByRole("button", { name: "Save Scout search" })).toBeFocused();
  await expect(page.getByText("1 of 4 features set by a flag.")).toBeVisible();

  // Matches per month 250 with a reason: from an override.
  const limit = card(page, "Matches per month");
  await limit.getByLabel("New limit for Matches per month").fill("250");
  await limit
    .getByLabel("Reason (optional) for Matches per month")
    .fill("Trial with extra matches");
  await limit.getByRole("button", { name: "Save Matches per month" }).click();
  await expect(limit.getByRole("status")).toHaveText(
    `Matches per month is now 250 matches for ${DEMO}.`,
  );
  const now = limit.getByRole("definition").filter({ hasText: "From an override" });
  await expect(now).toContainText("250 matches");
  await expect(limit.getByText("Reason: Trial with extra matches")).toBeVisible();
  await expect(limit.getByRole("button", { name: "Save Matches per month" })).toBeFocused();

  // With one flag and one override set, and a banner showing: axe and no side scroll.
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoAxeViolations(page);
    await expectNoSideScroll(page);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // A field error moves focus to the field.
  await limit.getByLabel("New limit for Matches per month").fill("-5");
  await limit.getByRole("button", { name: "Save Matches per month" }).click();
  await expect(limit.getByText("Enter a whole number of 0 or more.")).toBeVisible();
  await expect(limit.getByLabel("New limit for Matches per month")).toBeFocused();
  await expectNoAxeViolations(page);

  // Clear the override: the plan value is back, and focus lands on Save.
  await limit.getByRole("button", { name: "Use plan default for Matches per month" }).click();
  await expect(limit.getByRole("status")).toHaveText(
    "Matches per month follows the Pilot plan again: 100 matches.",
  );
  await expect(
    limit.getByRole("button", { name: "Use plan default for Matches per month" }),
  ).toHaveCount(0);
  await expect(limit.getByRole("button", { name: "Save Matches per month" })).toBeFocused();
  await expect(limit.getByLabel("New limit for Matches per month")).toHaveValue("");

  // Scout search back to the plan default.
  await flag.getByRole("radio", { name: "Plan default (Off)" }).check();
  await flag.getByRole("button", { name: "Save Scout search" }).click();
  await expect(flag.getByRole("status")).toHaveText(
    "Scout search follows the Pilot plan again: Off.",
  );
  await expect(chip(flag)).toHaveText("Off");
  await expect(flag.getByText("From the Pilot plan", { exact: true })).toBeVisible();
  await expect(page.getByText("No flags set. Every feature follows the plan.")).toBeVisible();
});

test("keyboard: set Scout search with arrow keys and Enter", async ({ page }) => {
  requireAdminPassword();
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAsAdmin(page, demoPath || "/admin/organisations?status=all");
  if (!demoPath) await openDemo(page);

  const flag = card(page, "Scout search");
  await flag.getByRole("radio", { name: /Plan default/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(flag.getByRole("radio", { name: "On", exact: true })).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(flag.getByLabel("Reason (optional) for Scout search")).toBeFocused();
  await page.keyboard.press("Tab");
  const save = flag.getByRole("button", { name: "Save Scout search" });
  await expect(save).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(flag.getByRole("status")).toHaveText(`Scout search is on for ${DEMO}.`);
  await expect(save).toBeFocused();

  // Put it back.
  await flag.getByRole("radio", { name: /Plan default/ }).check();
  await save.click();
  await expect(flag.getByRole("status")).toContainText("follows the Pilot plan again");
});

test("the All tab lists organisations with their plan, at every width", async ({ page }) => {
  requireAdminPassword();
  await signInAsAdmin(page, "/admin/organisations?status=all");
  await expect(page.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "page");
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const scope =
      width >= 768
        ? page.getByRole("region", { name: "All organisations, by name" })
        : page.getByRole("main").getByRole("list").last();
    await expect(scope.getByRole("link", { name: DEMO, exact: true })).toBeVisible();
    await expect(scope.getByRole("link", { name: "Wideline Lab", exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    await expectNoSideScroll(page);
  }
});

test("a club owner is sent to /forbidden", async ({ page }) => {
  requireAdminPassword();
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAsAdmin(page, "/admin/organisations?status=all");
  if (!demoPath) await openDemo(page);
  // The seeded admin is also Demo FC's owner; there, platform_admin does not count.
  await switchTo(page, DEMO);
  await page.goto(demoPath);
  await expect(page).toHaveURL(/\/forbidden/);
  await page.goto("/admin/organisations?status=all");
  await expect(page).toHaveURL(/\/forbidden/);
});
