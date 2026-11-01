import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers/a11y";
import { requireAdminPassword, signInAsAdmin } from "./helpers/auth";
import { findInviteEmail } from "./helpers/mailpit";
import { acceptAsNewUser, DEMO, invite, mail, switchTo, unique } from "./helpers/orgs";

// C06: matches, lineups, substitutions and delete (docs/build/design/C06.md,
// Surfaces 1, 2, 4 and 6). The seeded admin owns Wideline Demo FC; every run
// makes its own teams there. Markers need accepted footage, so the marker tool
// runs in upload.spec.ts after a real upload.

test.describe.configure({ mode: "serial" });

const WIDTHS = [375, 768, 1280];
const tag = unique();
const ownName = `U13 Matches ${tag}`;
const oppName = `Rivals Matches ${tag}`;
let ownId = "";
let matchPath = "";

async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function addTeam(page: Page, name: string, opposition = false) {
  await page.goto(opposition ? "/squad/teams/new?kind=opposition" : "/squad/teams/new");
  await page.getByLabel("Team name").fill(name);
  await page.getByLabel("Season").fill("2026");
  await page.getByRole("button", { name: "Add team" }).click();
  await expect(page).toHaveURL(/\/squad\/teams\/[^/?]+\?done=created/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

async function addPlayer(page: Page, first: string, last: string, number: string) {
  await page.goto(`/squad/players/new?team=${ownId}`);
  await page.getByLabel("First name").fill(first);
  await page.getByLabel("Last name").fill(last);
  await page.getByLabel("Date of birth").fill("2013-03-14");
  await page.getByLabel("Squad number (optional)").fill(number);
  await page.getByRole("button", { name: "Add player" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: `${first} ${last} added` }),
  ).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  requireAdminPassword();
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAsAdmin(page, "/organisations");
  await switchTo(page, DEMO);
});

test("create a match and find it under Draft", async ({ page }) => {
  test.setTimeout(120_000);
  ownId = await addTeam(page, ownName);
  await addPlayer(page, "Thabo", `Nkosi ${tag}`, "7");
  await addPlayer(page, "Sipho", `Dlamini ${tag}`, "9");
  await addPlayer(page, "Lebo", `Mokoena ${tag}`, "14");

  await page.goto(`/matches/new?team=${ownId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Create match" })).toBeVisible();
  // Q-024: the opposition is not listed yet; add it and come back with it chosen.
  await page.getByRole("link", { name: "Add an opposition team" }).click();
  await expect(page.getByRole("radio", { name: "An opposition team" })).toBeChecked();
  await page.getByLabel("Team name").fill(oppName);
  await page.getByLabel("Season").fill("2026");
  await page.getByRole("button", { name: "Add team" }).click();
  await expect(page).toHaveURL(/\/matches\/new\?away=/);
  await expect(page.getByLabel("Away team")).toHaveValue(
    new URL(page.url()).searchParams.get("away")!,
  );
  // What was chosen before the round trip is lost (Q-024 default); choose home again.
  await page.getByLabel("Home team").selectOption(ownId);
  await page.getByLabel("Venue").fill("Dobsonville Stadium");
  await page.getByLabel("Half length (min)").fill("35");
  // The same team twice is refused with the C06 copy.
  await page.getByLabel("Away team").selectOption({ label: `${ownName} (2026)` });
  await page.getByRole("button", { name: "Create match" }).click();
  await expect(page.getByText("Choose a different team from the home team.")).toBeVisible();
  await expect(page.getByLabel("Away team")).toBeFocused();
  await page.getByLabel("Away team").selectOption({ label: `${oppName} (2026)` });
  await page.getByRole("button", { name: "Create match" }).click();

  await expect(page).toHaveURL(/\/matches\/[^/?]+\?done=created/);
  matchPath = new URL(page.url()).pathname;
  await expect(page.getByRole("status").filter({ hasText: "Match created." })).toHaveText(
    "Match created. Upload the footage next.",
  );
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`${ownName} v ${oppName}`);
  await expect(page.getByText("Dobsonville Stadium · 2 × 35 min")).toBeVisible();
  await expect(page.getByRole("link", { name: "Upload footage" })).toBeVisible();

  // Floodlight: one list, newest first, filtered by who has to act.
  await page.goto(`/matches?team=${ownId}&filter=needs-you`);
  await expect(page.getByRole("link", { name: /Needs you/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
  const list = page.getByRole("region", { name: "Matches, newest first", exact: true });
  await expect(list.getByRole("link", { name: new RegExp(ownName) })).toBeVisible();
  await expect(list.getByRole("link", { name: "Upload footage" })).toBeVisible();
});

test("enter a lineup with a shirt number other than the squad number, and a substitution", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(`${matchPath}/lineup`);
  await expect(page.getByRole("heading", { level: 1, name: "Lineups" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Side" }).getByRole("link").first(),
  ).toHaveAttribute("aria-current", "page");
  // Substitutions need a saved lineup first.
  await expect(page.getByText("Save the lineup first. Then add substitutions.")).toBeVisible();

  const thabo = page.getByRole("group", { name: new RegExp(`Thabo Nkosi ${tag}`) });
  const sipho = page.getByRole("group", { name: new RegExp(`Sipho Dlamini ${tag}`) });
  const lebo = page.getByRole("group", { name: new RegExp(`Lebo Mokoena ${tag}`) });
  await expect(thabo.getByLabel("Shirt number")).toHaveValue("7");
  await thabo.getByLabel("Selection").selectOption("starter");
  await thabo.getByLabel("Shirt number").fill("17");
  await thabo.getByLabel("Position").selectOption("ST");
  await sipho.getByLabel("Selection").selectOption("starter");
  await lebo.getByLabel("Selection").selectOption("substitute");
  await expect(page.getByText(/2\s+starting · 1\s+sub/)).toBeVisible();
  await page.getByRole("button", { name: "Save lineup" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Lineup saved." })).toBeVisible();

  await page.getByLabel("Minute").fill("60");
  await page.getByLabel("Player off").selectOption({ label: `#17 Thabo Nkosi ${tag}` });
  await page.getByLabel("Player on").selectOption({ label: `#14 Lebo Mokoena ${tag}` });
  await page.getByRole("button", { name: "Add substitution" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Substitution added." })).toBeVisible();
  await expect(page.getByText("60 min", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove the substitution at 60 min" }),
  ).toBeVisible();
  await expect(page.getByLabel("Minute")).toBeFocused();

  await page.goto(matchPath);
  await expect(page.getByText("2 starters · 1 substitute · 1 substitution")).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit lineups" })).toBeVisible();
});

test("match pages pass axe at 375, 768 and 1280", async ({ page }) => {
  test.setTimeout(240_000);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, path] of [
      ["list", `/matches?team=${ownId}`],
      ["new", `/matches/new?team=${ownId}`],
      ["detail", matchPath],
      ["edit", `${matchPath}/edit`],
      ["lineup", `${matchPath}/lineup`],
      ["lineup-away", `${matchPath}/lineup?side=away`],
      ["upload", `${matchPath}/upload`],
      ["markers", `${matchPath}/markers`],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoAxeViolations(page);
      await expectNoSideScroll(page);
      await page.screenshot({
        path: test.info().outputPath(`matches-${name}-${width}.png`),
        fullPage: true,
      });
    }
  }
});

test("delete is for owners and admins: hidden for a coach, works for an owner", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await page.goto("/settings/members");
  const coachEmail = mail(`matches-coach-${tag}`);
  await invite(page, coachEmail, "coach");
  const coach = await acceptAsNewUser(
    browser,
    (await findInviteEmail(page.context(), coachEmail)).path,
    "Matches Coach",
  );
  await coach.goto(matchPath);
  await expect(coach.getByText("Only owners and admins can delete a match.")).toBeVisible();
  await expect(coach.getByRole("button", { name: "Delete match" })).toHaveCount(0);
  await expectNoAxeViolations(coach);

  await page.goto(matchPath);
  await page.getByRole("button", { name: "Delete match" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete this match?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Delete match" }).click();
  await expect(page).toHaveURL(/\/matches\?done=deleted/);
  await expect(page.getByRole("status").filter({ hasText: "Match deleted." })).toHaveText(
    "Match deleted. Its lineups and markers are gone. The footage file is deleted 7 days after upload.",
  );
  await page.goto(matchPath);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/not found/i);
});
