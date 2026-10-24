import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { requireAdminPassword, signInAsAdmin } from "./helpers/auth";

// The component gallery (D01): every component in both themes, at the three
// required widths (NFR24), with screenshot baselines and no axe violations
// (NFR23, NFR27).

// 13 since C06 added the Progress block.
const COMPONENTS = 13;
// Hides the Next.js dev-tools badge, which only exists on the dev server.
const SCREENSHOT_CSS = new URL("./helpers/screenshot.css", import.meta.url).pathname;
const WIDTHS = [375, 768, 1280];

async function expectAllBlocks(page: Page) {
  for (const theme of ["light", "dark"]) {
    const band = page.locator(`[data-gallery-theme="${theme}"]`);
    await expect(band.locator("[data-component]")).toHaveCount(COMPONENTS);
  }
}

test("signed out, the gallery redirects to login", async ({ page }) => {
  await page.goto("/dev/components");
  await expect(page).toHaveURL(/\/login\?next=%2Fdev%2Fcomponents/);
});

test.describe("signed in as a platform admin", () => {
  test.beforeEach(async ({ page }) => {
    requireAdminPassword();
    await signInAsAdmin(page, "/dev/components");
    await expect(page.getByRole("heading", { level: 1, name: "Components" })).toBeVisible();
  });

  for (const width of WIDTHS) {
    // Axe and the screenshot are separate tests, so a pixel diff never hides axe results.
    test(`gallery at ${width}px has no axe violations`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await expectAllBlocks(page);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });

    test(`gallery at ${width}px matches the baseline`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => document.fonts.ready);
      await expectAllBlocks(page);

      await expect(page).toHaveScreenshot(`gallery-${width}.png`, {
        fullPage: true,
        stylePath: SCREENSHOT_CSS,
      });
    });
  }

  test("keyboard focus on a PlayerCard draws the ring around the whole card", async ({ page }) => {
    const link = page.locator(".wl-player__link").first();
    const isFocused = () => link.evaluate((el) => el === document.activeElement);
    for (let i = 0; i < 200 && !(await isFocused()); i++) await page.keyboard.press("Tab");
    expect(await isFocused()).toBe(true);

    const card = page.locator(".wl-player").first();
    const outline = (el: Element) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: s.outlineWidth, offset: s.outlineOffset };
    };
    expect(await card.evaluate(outline)).toEqual({ style: "solid", width: "2px", offset: "2px" });
    // The link's own ring would be clipped by the name's line clamp, so the card replaces it.
    expect((await link.evaluate(outline)).style).toBe("none");
  });

  test("the two bands use different surfaces", async ({ page }) => {
    const surface = (theme: string) =>
      page
        .locator(`[data-gallery-theme="${theme}"]`)
        .evaluate((el) => getComputedStyle(el).getPropertyValue("--surface").trim());
    const [light, dark] = [await surface("light"), await surface("dark")];
    expect(light).not.toBe("");
    expect(light).not.toBe(dark);
  });
});
