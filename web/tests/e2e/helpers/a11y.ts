import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

// Accessibility checks shared by the specs (NFR23, NFR27).

export async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations, page.url()).toEqual([]);
}

/** Presses Tab until the locator has focus, then checks the focus ring is drawn. */
export async function expectKeyboardFocusRing(page: Page, target: Locator) {
  const focused = () => target.evaluate((el) => el === document.activeElement);
  for (let i = 0; i < 60 && !(await focused()); i++) await page.keyboard.press("Tab");
  expect(await focused()).toBe(true);
  const outline = await target.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).toBe("solid");
}
