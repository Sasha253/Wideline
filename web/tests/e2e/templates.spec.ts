import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers/a11y";
import { requireAdminPassword, signInAsAdmin } from "./helpers/auth";
import { LAB, switchTo } from "./helpers/orgs";

// D02 page templates and shared states inside the app shell (/dev/templates): axe at
// 375, 768 and 1280 px, layout checks, and Linux screenshot baselines.

const WIDTHS = [375, 768, 1280];
const TEMPLATES = ["list", "detail", "workspace", "decision", "states"];
// Hides the Next.js dev-tools badge, which only exists on the dev server.
const SCREENSHOT_CSS = new URL("./helpers/screenshot.css", import.meta.url).pathname;

test.beforeEach(async ({ page }) => {
  requireAdminPassword();
  await signInAsAdmin(page, "/organisations");
  await switchTo(page, LAB);
});

test("the showcase index links every template", async ({ page }) => {
  await page.goto("/dev/templates");
  await expect(page.getByRole("heading", { level: 1, name: "Page templates" })).toBeVisible();
  for (const name of ["List page", "Detail page", "Workspace", "Decision flow", "States"]) {
    await expect(page.getByRole("main").getByRole("link", { name, exact: true })).toBeVisible();
  }
});

for (const width of WIDTHS) {
  for (const name of TEMPLATES) {
    test(`${name} at ${width}px has no axe violations`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/dev/templates/${name}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test(`${name} at ${width}px matches the baseline`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/dev/templates/${name}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`template-${name}-${width}.png`, {
        fullPage: true,
        stylePath: SCREENSHOT_CSS,
      });
    });
  }
}

test("workspace panes stack at 375 and sit side by side at 1280", async ({ page }) => {
  const pane = (name: string) => page.getByRole("region", { name });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/dev/templates/workspace");
  let primary = (await pane("Match video").boundingBox())!;
  let side = (await pane("Events").boundingBox())!;
  expect(side.y).toBeGreaterThanOrEqual(primary.y + primary.height);

  await page.setViewportSize({ width: 1280, height: 900 });
  primary = (await pane("Match video").boundingBox())!;
  side = (await pane("Events").boundingBox())!;
  expect(Math.abs(side.y - primary.y)).toBeLessThan(1);
  expect(side.x).toBeGreaterThan(primary.x + primary.width);
  expect(primary.width).toBeGreaterThan(side.width);
});

test("decision choices are at least 44px tall at 375 and keep the focus ring", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/dev/templates/decision");
  const choices = page.locator(".wl-decision__choice");
  await expect(choices).toHaveCount(2);
  for (const choice of await choices.all()) {
    expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  const yes = page.getByRole("radio", { name: "Yes, scouts can see them" });
  await yes.focus();
  await page.keyboard.press("Space");
  await expect(yes).toBeChecked();
  // Keyboard focus draws the ring around the whole card (PlayerCard pattern).
  await page.keyboard.press("ArrowDown");
  const no = page.getByRole("radio", { name: "No, keep them inside the club" });
  await expect(no).toBeChecked();
  expect(await choices.nth(1).evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
});

// NFR23 / WCAG 2.2 SC 2.4.11: on phones the fixed tab bar must never cover the focused control.
// scroll-padding-bottom makes the browser scroll focus clear of the bar.
// The states page is longer than the viewport and has controls below the first screen.
test("states at 375px: Tab never leaves focus under the tab bar", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/dev/templates/states");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const tabbar = page.locator(".wl-tabbar");
  await expect(tabbar).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true);
  const barTop = (await tabbar.boundingBox())!.y;

  let checked = 0;
  let maxScroll = 0;
  for (let i = 0; i < 120; i++) {
    await page.keyboard.press("Tab");
    const f = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      return {
        label: `${el.tagName} ${(el.textContent ?? "").trim().slice(0, 40)}`,
        inBar: !!el.closest(".wl-tabbar"),
        bottom: r.bottom,
        scrollY,
      };
    });
    if (!f) break;
    // Focus has reached the tab bar itself, which comes last in the shell.
    if (f.inBar) break;
    maxScroll = Math.max(maxScroll, f.scrollY);
    expect(f.bottom, `${f.label} sits under the tab bar`).toBeLessThanOrEqual(barTop);
    checked++;
  }
  expect(checked).toBeGreaterThan(3);
  // The walk scrolled the page, so the check covered content below the first screen.
  expect(maxScroll).toBeGreaterThan(0);
});
