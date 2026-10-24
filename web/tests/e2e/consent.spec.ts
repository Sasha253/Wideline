import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers/a11y";
import { requireAdminPassword, signInAsAdmin } from "./helpers/auth";
import { findEmailLink, findInviteEmail } from "./helpers/mailpit";
import { acceptAsNewUser, DEMO, invite, mail, switchTo, unique } from "./helpers/orgs";

// C05: consent records and guardian consent (docs/build/design/C05.md). Every
// run makes its own team and under-18 player in Wideline Demo FC.

test.describe.configure({ mode: "serial" });

const WIDTHS = [375, 768, 1280];
const tag = unique();
const teamName = `U14 Consent ${tag}`;
const first = "Lebo";
const name = `${first} Consent${tag}`;
let playerPath = "";
let teamId = "";

/** axe at 375, 768 and 1280 px, in the light and dark system themes. */
async function axeEverywhere(page: Page) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    // Without JavaScript the tokens follow prefers-color-scheme directly.
    if (await page.evaluate(() => "theme" in document.documentElement.dataset)) {
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    }
    // Buttons and inputs animate their colours for 150ms; measure after that.
    await page.waitForTimeout(300);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoAxeViolations(page);
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function expectNothingChecked(page: Page) {
  const checked = await page.locator('input[type="radio"]:checked, input[type="checkbox"]:checked');
  await expect(checked).toHaveCount(0);
}

async function guardianContext(browser: Browser, javaScriptEnabled = true) {
  const context = await browser.newContext({ javaScriptEnabled });
  return { context, page: await context.newPage() };
}

test.beforeEach(async ({ page }) => {
  requireAdminPassword();
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAsAdmin(page, "/organisations");
  await switchTo(page, DEMO);
});

test("an admin records and withdraws a guardian's consent", async ({ page }) => {
  test.setTimeout(240_000);
  // A team and an under-18 player.
  await page.goto("/squad/teams/new");
  await page.getByLabel("Team name").fill(teamName);
  await page.getByLabel("Season").fill("2026");
  await page.getByRole("button", { name: "Add team" }).click();
  await expect(page).toHaveURL(/\/squad\/teams\/[^/?]+\?done=created/);
  teamId = new URL(page.url()).pathname.split("/").pop()!;
  await page.goto(`/squad/players/new?team=${teamId}`);
  await page.getByLabel("First name").fill(first);
  await page.getByLabel("Last name").fill(`Consent${tag}`);
  await page.getByLabel("Date of birth").fill("2012-05-02");
  await page.getByRole("button", { name: "Add player" }).click();
  await page.getByRole("link", { name: "View player" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  playerPath = new URL(page.url()).pathname;

  const hero = page.locator(".wl-hero");
  await expect(hero.locator(".wl-chip")).toHaveText("No consent");
  await expect(
    page.getByText(`No consent recorded yet. Wideline keeps no stats for ${first}.`),
  ).toBeVisible();

  // The record form: nothing pre-chosen; errors on an empty submit.
  await page.getByRole("link", { name: "Record consent" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Record consent for ${name}` }),
  ).toBeVisible();
  await expectNothingChecked(page);
  await axeEverywhere(page);
  await page.getByRole("button", { name: "Save consent" }).click();
  await expect(page.getByText("Enter the full name of the parent or guardian.")).toBeVisible();
  await expect(page.getByText(`Choose how they are related to ${first}.`)).toBeVisible();
  await expect(page.getByText("Choose yes or no for club stats.")).toBeVisible();
  await expect(page.getByText("Confirm that they saw this wording.")).toBeVisible();
  await expect(page.getByLabel("Parent or guardian's full name")).toBeFocused();
  await axeEverywhere(page);

  await page.getByLabel("Parent or guardian's full name").fill("Thandi Mokoena");
  await page
    .getByRole("group", { name: `How are they related to ${first}?` })
    .getByLabel("Parent", { exact: true })
    .check();
  await page.getByLabel("Signed paper form").check();
  await page
    .getByRole("group", { name: /record .*stats\?/ })
    .getByLabel("Yes", { exact: true })
    .check();
  await page.getByLabel("Yes, scouts can see them").check();
  await page.getByLabel(/The person deciding saw this wording/).check();
  await page.getByRole("button", { name: "Save consent" }).click();

  await expect(page).toHaveURL(/\?done=consent/);
  await expect(page.getByRole("status").filter({ hasText: "Consent saved." })).toHaveText(
    `Consent saved. ${first}'s consent is now Scout-visible.`,
  );
  await expect(hero.locator(".wl-chip")).toHaveText("Scout-visible");
  await expect(page.getByRole("heading", { level: 2, name: "Consent", exact: true })).toBeFocused();
  await expect(page.getByText("Thandi Mokoena", { exact: true }).first()).toBeVisible();

  // The squad list shows the badge in the Consent column.
  await page.goto(`/squad?team=${teamId}`);
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row.locator(".wl-chip")).toHaveText("Scout-visible");

  // Withdraw through the dialog.
  await page.goto(playerPath);
  await page.getByRole("button", { name: "Withdraw consent" }).click();
  const dialog = page.getByRole("dialog", { name: `Withdraw consent for ${name}?` });
  await expect(dialog.getByLabel("Who asked to withdraw?")).toBeFocused();
  await expect(
    dialog.getByRole("group", { name: `How are they related to ${first}? (optional)` }),
  ).toBeVisible();
  await expect(dialog.getByText("You can record consent again later.")).toBeVisible();
  await axeEverywhere(page);
  await dialog.getByRole("button", { name: "Withdraw consent" }).click();
  await expect(dialog.getByText("Enter the name of the person who asked.")).toBeVisible();
  await dialog.getByLabel("Who asked to withdraw?").fill("Thandi Mokoena");
  await dialog.getByLabel("In person").check();
  await dialog.getByRole("button", { name: "Withdraw consent" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Consent withdrawn." })).toHaveText(
    `Consent withdrawn. Scouts and the club can no longer see ${first}'s stats.`,
  );
  await expect(hero.locator(".wl-chip")).toHaveText("Withdrawn");
  await expect(page.getByRole("button", { name: "Withdraw consent" })).toHaveCount(0);

  // The history: two rows, newest first (table at 1280, cards at 375).
  const history = page.getByRole("region", { name: `Consent history for ${name}, newest first` });
  await expect(history.getByRole("row")).toHaveCount(3);
  await expect(history.getByRole("row").nth(1)).toContainText("Withdrawn");
  await expect(history.getByRole("row").nth(2)).toContainText("Scout-visible");
  await page.setViewportSize({ width: 375, height: 900 });
  const cards = page
    .getByRole("heading", { level: 2, name: "Consent history" })
    .locator("xpath=..")
    .getByRole("listitem");
  await expect(cards).toHaveCount(2);
  await page.setViewportSize({ width: 1280, height: 900 });
  await axeEverywhere(page);
});

test("a guardian answers through the link, with and without JavaScript", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  await page.goto(playerPath);
  // Ask a guardian opens a dialog with an optional email address (Q-019).
  await page.getByRole("button", { name: "Ask a guardian" }).click();
  const askDialog = page.getByRole("dialog", { name: `Ask ${first}'s parent or guardian` });
  const emailField = askDialog.getByLabel("Guardian's email address (optional)");
  await expect(emailField).toBeFocused();
  await axeEverywhere(page);
  await emailField.fill("not-an-email");
  await askDialog.getByRole("button", { name: "Create link" }).click();
  await expect(
    askDialog.getByText("Enter an email address, for example name@club.co.za."),
  ).toBeVisible();
  await axeEverywhere(page);
  const guardianEmail = mail(`guardian-${tag}`);
  await emailField.fill(guardianEmail);
  await askDialog.getByRole("button", { name: "Create link" }).click();
  const linkBox = page.getByRole("textbox", { name: "Guardian link" });
  await expect(linkBox).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Guardian link created." })).toHaveText(
    `Guardian link created. We emailed the link to g***@${guardianEmail.split("@")[1]}.`,
  );
  await expect(page.locator(".wl-hero .wl-chip")).toHaveText("Requested");
  await axeEverywhere(page);
  const linkPath = new URL(await linkBox.inputValue()).pathname;
  expect(page.url()).not.toContain(linkPath);

  // The email lands in Mailpit with the same link, the first name only.
  const emailed = await findEmailLink(
    page.context(),
    guardianEmail,
    "is asking about",
    /https?:\/\/[^\s]+\/consent\/[\w-]+/,
  );
  expect(new URL(emailed.url).pathname).toBe(linkPath);
  expect(emailed.text).toContain(`${first}'s`);
  expect(emailed.text).not.toContain(`Consent${tag}`);
  expect(emailed.text).not.toContain("2012");

  // Email the link again: the dialog names the stored address, masked.
  await page.reload();
  await page.getByRole("button", { name: "Email the link again" }).click();
  const resendDialog = page.getByRole("dialog", { name: "Email the link again?" });
  await expect(resendDialog).toContainText(`g***@${guardianEmail.split("@")[1]}`);
  await expect(resendDialog).not.toContainText(guardianEmail);
  await axeEverywhere(page);
  await resendDialog.getByRole("button", { name: "Cancel" }).click();

  // A fresh browser with no session follows the emailed link and completes every step.
  const { context, page: g } = await guardianContext(browser);
  await g.setViewportSize({ width: 375, height: 800 });
  await g.goto(emailed.url);
  await expect(g.getByRole("heading", { level: 1 })).toContainText(`record ${first}'s match stats`);
  await expect(g.getByText("outside South Africa", { exact: false })).toBeVisible();
  await axeEverywhere(g);
  await g.getByRole("button", { name: "Continue" }).click();
  await expect(
    g.getByRole("heading", { level: 1, name: `Can Wideline Demo FC record ${first}'s stats?` }),
  ).toBeVisible();
  await expectNothingChecked(g);
  await axeEverywhere(g);
  await g.getByText("Yes, the club can record them").click();
  await g.getByRole("button", { name: "Continue" }).click();
  await expect(
    g.getByRole("heading", { level: 1, name: `Can scouts see ${first}'s stats?` }),
  ).toBeVisible();
  await expectNothingChecked(g);
  await axeEverywhere(g);
  await g.getByText("No, keep them inside the club").click();
  await g.getByRole("button", { name: "Continue" }).click();
  await expect(g.getByRole("heading", { level: 1, name: "Who is answering?" })).toBeVisible();
  await expect(g.getByText("Step 4 of 4")).toBeVisible();
  await expectNothingChecked(g);
  await axeEverywhere(g);
  await g.getByLabel("Your full name").fill("Thandi Mokoena");
  await g.getByText("Parent", { exact: true }).click();
  await g.getByText(`I am ${first}'s parent or guardian and I am 18 or over.`).click();
  await g.getByRole("button", { name: "Save my answer" }).click();
  await expect(
    g.getByRole("heading", { level: 1, name: "Thank you. Your answer is saved." }),
  ).toBeVisible();
  await axeEverywhere(g);

  // The club sees it at once.
  await page.reload();
  await expect(page.locator(".wl-hero .wl-chip")).toHaveText("Club only");
  await expect(page.getByText("The guardian, through the link").first()).toBeVisible();

  // The same link: the guardian's answer, then stop sharing.
  await g.goto(linkPath);
  await expect(
    g.getByRole("heading", { level: 1, name: `Your answer for ${first}` }),
  ).toBeVisible();
  await axeEverywhere(g);
  await g.getByRole("link", { name: `Stop sharing ${first}'s stats` }).click();
  await expect(
    g.getByRole("heading", { level: 1, name: `Stop sharing ${first}'s stats?` }),
  ).toBeVisible();
  await axeEverywhere(g);
  await g.getByRole("button", { name: "Stop sharing" }).click();
  await expect(
    g.getByRole("heading", { level: 1, name: `${first}'s stats are no longer shared` }),
  ).toBeVisible();
  await axeEverywhere(g);
  await context.close();
  await page.reload();
  await expect(page.locator(".wl-hero .wl-chip")).toHaveText("Withdrawn");

  // A new link replaces the old one; the old one is closed.
  await page.getByRole("button", { name: "Create a new link" }).click();
  const dialog = page.getByRole("dialog", { name: "Create a new guardian link?" });
  await dialog.getByRole("button", { name: "Create new link" }).click();
  const newPath = new URL(await page.getByRole("textbox", { name: "Guardian link" }).inputValue())
    .pathname;
  expect(newPath).not.toBe(linkPath);

  // The replaced link is closed (axe needs JavaScript, so this context has it).
  const closed = await guardianContext(browser);
  await closed.page.goto(linkPath);
  await expect(
    closed.page.getByRole("heading", { level: 1, name: "This link no longer works" }),
  ).toBeVisible();
  await axeEverywhere(closed.page);
  await closed.page.goto("/consent/not-a-real-token");
  await expect(
    closed.page.getByRole("heading", { level: 1, name: "This link does not work" }),
  ).toBeVisible();
  await axeEverywhere(closed.page);
  await closed.context.close();

  // Without JavaScript: every step still works.
  const noJs = await guardianContext(browser, false);
  await noJs.page.goto(linkPath);
  await expect(
    noJs.page.getByRole("heading", { level: 1, name: "This link no longer works" }),
  ).toBeVisible();
  await noJs.page.goto(newPath);
  await noJs.page.getByRole("button", { name: "Continue" }).click();
  await noJs.page.getByText("No, do not record them").click();
  await noJs.page.getByRole("button", { name: "Continue" }).click();
  await expect(noJs.page.getByText("Step 3 of 3")).toBeVisible();
  await noJs.page.getByLabel("Your full name").fill("Thandi Mokoena");
  await noJs.page.getByText("Legal guardian", { exact: true }).click();
  await noJs.page.getByText(`I am ${first}'s parent or guardian and I am 18 or over.`).click();
  await noJs.page.getByRole("button", { name: "Save my answer" }).click();
  await expect(
    noJs.page.getByRole("heading", { level: 1, name: "Thank you. Your answer is saved." }),
  ).toBeVisible();
  await expect(noJs.page.getByText("Club stats")).toBeVisible();
  await noJs.context.close();
  await page.reload();
  await expect(page.locator(".wl-hero .wl-chip")).toHaveText("No consent");
  await expect(page.getByText(/Thandi Mokoena \(Legal guardian\) said no on/)).toBeVisible();

  // Turn the link off: it closes, and the state stays.
  await page.getByRole("button", { name: "Turn off link" }).click();
  await page
    .getByRole("dialog", { name: "Turn off the guardian link?" })
    .getByRole("button", { name: "Turn off link" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Guardian link turned off." }),
  ).toBeVisible();
  await expect(page.locator(".wl-hero .wl-chip")).toHaveText("No consent");
});

test("the print page hides the shell when printed", async ({ page }) => {
  await page.goto(`${playerPath}/consent/print`);
  await expect(page.getByRole("heading", { level: 1, name: `Consent for ${name}` })).toBeVisible();
  await axeEverywhere(page);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
  await expect(page.locator(".wl-sidebar")).toBeHidden();
  await expect(page.getByRole("article")).toBeVisible();
  await page.emulateMedia({ media: "screen" });
});

test("a coach sees consent but cannot record or withdraw it", async ({ page, browser }) => {
  test.setTimeout(120_000);
  // Grant consent first, so Withdraw would show for an admin.
  await page.goto(`${playerPath}/consent`);
  await page.getByLabel("Parent or guardian's full name").fill("Thandi Mokoena");
  await page
    .getByRole("group", { name: `How are they related to ${first}?` })
    .getByLabel("Parent", { exact: true })
    .check();
  await page.getByLabel("In person").check();
  await page
    .getByRole("group", { name: /record .*stats\?/ })
    .getByLabel("Yes", { exact: true })
    .check();
  await page.getByLabel("No, keep them inside the club").check();
  await page.getByLabel(/The person deciding saw this wording/).check();
  await page.getByRole("button", { name: "Save consent" }).click();
  await expect(page).toHaveURL(/\?done=consent/);
  await expect(page.getByRole("button", { name: "Withdraw consent" })).toBeVisible();

  await page.goto("/settings/members");
  const coachEmail = mail(`consent-coach-${tag}`);
  await invite(page, coachEmail, "coach");
  const coach = await acceptAsNewUser(
    browser,
    (await findInviteEmail(page.context(), coachEmail)).path,
    "Consent Coach",
  );
  await coach.goto(playerPath);
  await expect(coach.locator(".wl-hero .wl-chip")).toHaveText("Club only");
  await expect(
    coach.getByText("Only owners and admins can record or withdraw consent."),
  ).toBeVisible();
  for (const label of [
    "Withdraw consent",
    "Ask a guardian",
    "Email the link again",
    "Turn off link",
  ]) {
    await expect(coach.getByRole("button", { name: label })).toHaveCount(0);
  }
  await expect(coach.getByRole("link", { name: /Record consent|Change consent/ })).toHaveCount(0);
  await expect(coach.getByRole("link", { name: "Print paper form" })).toBeVisible();
  await coach.goto(`${playerPath}/consent`);
  await expect(
    coach.getByRole("heading", { level: 2, name: "Only owners and admins can record consent" }),
  ).toBeVisible();
  await expect(coach.getByRole("button", { name: "Save consent" })).toHaveCount(0);
  await expectNoAxeViolations(coach);
});
