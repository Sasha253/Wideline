import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers/a11y";
import { requireAdminPassword, signInAsAdmin } from "./helpers/auth";
import { findInviteEmail } from "./helpers/mailpit";
import { acceptAsNewUser, DEMO, invite, mail, switchTo, unique } from "./helpers/orgs";

// C04: teams, players, CSV import, departures and opposition placeholders
// (docs/build/design/C04.md). Team names are unique per season, so every run
// makes its own teams in Wideline Demo FC.

test.describe.configure({ mode: "serial" });

const WIDTHS = [375, 768, 1280];
const tag = unique();
const teamName = `U15 E2E ${tag}`;
const teamLabel = `${teamName} (2026)`;
let teamPath = "";
let teamId = "";
let thaboPath = "";

async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function addTeam(page: Page, name: string, { opposition = false } = {}) {
  await page.goto(opposition ? "/squad/teams/new?kind=opposition" : "/squad/teams/new");
  if (opposition) {
    await expect(page.getByRole("radio", { name: "An opposition team" })).toBeChecked();
  }
  await page.getByLabel("Team name").fill(name);
  await page.getByLabel("Season").fill("2026");
  await page.getByRole("button", { name: "Add team" }).click();
  await expect(page).toHaveURL(/\/squad\/teams\/[^/?]+\?done=created/);
  await expect(page.getByRole("heading", { level: 1, name: `${name} (2026)` })).toBeVisible();
}

async function fillPlayer(
  page: Page,
  p: { first: string; last: string; dob: string; number?: string },
) {
  await page.getByLabel("First name").fill(p.first);
  await page.getByLabel("Last name").fill(p.last);
  await page.getByLabel("Date of birth").fill(p.dob);
  await page.getByLabel("Squad number (optional)").fill(p.number ?? "");
}

test.beforeEach(async ({ page }) => {
  requireAdminPassword();
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAsAdmin(page, "/organisations");
  await switchTo(page, DEMO);
});

test("add a team and players; a duplicate number is refused; mark a player departed", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await addTeam(page, teamName);
  await expect(page.getByRole("status")).toHaveText(`${teamLabel} added. Add players next.`);
  teamPath = new URL(page.url()).pathname;
  teamId = teamPath.split("/").pop()!;

  // Add Thabo with number 7; the form stays for the next player, team kept.
  await page.getByRole("link", { name: "Add player" }).click();
  await expect(page).toHaveURL(new RegExp(`/squad/players/new\\?team=${teamId}`));
  await expect(page.getByLabel("Team")).toHaveValue(teamId);
  await fillPlayer(page, { first: "Thabo", last: "Nkosi", dob: "2011-03-14", number: "7" });
  await page.getByRole("button", { name: "Add player" }).click();
  const added = page.getByRole("status").filter({ hasText: "Thabo Nkosi added" });
  await expect(added).toHaveText(`Thabo Nkosi added to ${teamLabel}. View player`);
  await expect(page.getByLabel("First name")).toBeFocused();
  await expect(page.getByLabel("First name")).toHaveValue("");
  await expect(page.getByLabel("Team")).toHaveValue(teamId);

  // Same number again: the clear message on Squad number, nothing added.
  await fillPlayer(page, { first: "Sipho", last: "Dlamini", dob: "2011-05-02", number: "7" });
  await page.getByRole("button", { name: "Add player" }).click();
  await expect(
    page.getByText(
      `Number 7 is already taken in ${teamLabel} by Thabo Nkosi. Choose another number.`,
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Squad number (optional)")).toBeFocused();
  await page.getByLabel("Squad number (optional)").fill("8");
  await page.getByRole("button", { name: "Add player" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Sipho Dlamini added" })).toBeVisible();

  // The squad list shows both, by shirt number.
  await page.goto(`/squad?team=${teamId}`);
  const table = page.getByRole("region", {
    name: `Current players in ${teamLabel}, by shirt number`,
  });
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table.getByRole("row").nth(1)).toContainText("7Thabo Nkosi");
  await expect(
    page.getByRole("navigation", { name: "Player status" }).getByRole("link", { name: /Current/ }),
  ).toHaveText("Current 2 players");

  // Mark Thabo departed: read-only page, records kept.
  await table.getByRole("link", { name: "Thabo Nkosi" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Thabo Nkosi" })).toBeVisible();
  // Read the path once the player page is showing, not while the click navigates.
  thaboPath = new URL(page.url()).pathname;
  await page.getByRole("button", { name: "Mark as departed" }).click();
  const dialog = page.getByRole("dialog", { name: "Mark Thabo Nkosi as departed?" });
  await expect(dialog).toContainText("No data is deleted");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Mark as departed" }).click();
  await expect(page).toHaveURL(/\?done=departed/);
  await expect(page.getByRole("status")).toHaveText(
    "Thabo Nkosi is marked as departed. Their records are kept.",
  );
  // C05: the hero shows the ConsentBadge first, then the Departed chip.
  await expect(page.locator(".wl-hero .wl-chip")).toHaveText(["No consent", "Departed"]);
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mark as departed" })).toHaveCount(0);
  await expect(page.getByText("Left on", { exact: true })).toBeVisible();

  // Gone from Current, listed under Departed with the chip.
  await page.goto(`/squad?team=${teamId}`);
  await expect(page.getByRole("link", { name: "Thabo Nkosi" })).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Player status" })
    .getByRole("link", { name: /Departed/ })
    .click();
  const departed = page.getByRole("region", {
    name: `Departed players in ${teamLabel}, by date left`,
  });
  await expect(departed.getByRole("row").nth(1)).toContainText("Thabo Nkosi");
  // C05: the Consent column sits after Name, so the row has two chips.
  await expect(departed.locator(".wl-chip")).toHaveText(["Departed", "No consent"]);

  // Undo within 7 days (Q-012): back in the squad, then depart again for the later tests.
  await page.goto(thaboPath);
  await expect(page.getByText(/^You can undo this until \d{1,2} \w{3} \d{4}\.$/)).toBeVisible();
  await page.getByRole("button", { name: "Undo departure" }).click();
  await expect(page).toHaveURL(/\?done=restored/);
  await expect(page.getByRole("status")).toHaveText("Thabo Nkosi is back in the squad.");
  await expect(page.locator(".wl-hero .wl-chip")).toHaveText(["No consent"]);
  await page.getByRole("button", { name: "Mark as departed" }).click();
  await page
    .getByRole("dialog", { name: "Mark Thabo Nkosi as departed?" })
    .getByRole("button", { name: "Mark as departed" })
    .click();
  await expect(page).toHaveURL(/\?done=departed/);
});

test("import a CSV: the preview shows row errors and commits nothing until confirmed", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const name = `U17 CSV ${tag}`;
  await addTeam(page, name);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await page.goto(`/squad/import?team=${id}`);
  await expect(page.getByLabel("Team")).toHaveValue(id);
  const csv = {
    name: "squad.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "First name;Surname;DOB;Position;Foot;Height;Shirt;Notes",
        `Ayanda;Zulu ${tag};14/03/2011;RW;L;165;10;`,
        "Kagiso;Molefe;31/02/2012;;;;;",
        `Neo;Khumalo ${tag};2011-06-01;ST;R;;9;`,
      ].join("\r\n"),
    ),
  };
  await page.getByLabel("CSV file").setInputFiles(csv);
  await page.getByRole("button", { name: "Check file" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Check the preview" })).toBeFocused();
  // Choose another file: back to step 1, team kept, focus on the file input.
  await page.getByRole("button", { name: "Choose another file" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Choose a file" })).toBeVisible();
  await expect(page.getByLabel("CSV file")).toBeFocused();
  await expect(page.getByLabel("Team")).toHaveValue(id);
  await page.getByLabel("CSV file").setInputFiles(csv);
  await page.getByRole("button", { name: "Check file" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Check the preview" })).toBeFocused();
  await expect(page.getByText("2 rows ready, 1 row with errors.")).toBeVisible();
  await expect(page.getByText("Ignored columns: Notes. They are not imported.")).toBeVisible();
  const rows = page.getByRole("region", { name: "Rows in squad.csv, by line" });
  await expect(rows.getByText("Date of birth: 31/02/2012 is not a real date.")).toBeVisible();

  // Nothing is saved yet.
  const other = await context.newPage();
  await other.goto(`/squad?team=${id}`);
  await expect(
    other.getByRole("heading", { name: `No players in ${name} (2026) yet` }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Import 2 players, skip 1 row with errors" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Done" })).toBeFocused();
  await expect(page.getByRole("status")).toHaveText(`2 players added to ${name} (2026).`);
  await page.getByRole("link", { name: "View squad" }).click();
  const table = page.getByRole("region", {
    name: `Current players in ${name} (2026), by shirt number`,
  });
  await expect(table.getByRole("link", { name: `Neo Khumalo ${tag}` })).toBeVisible();
  await expect(table.getByRole("link", { name: `Ayanda Zulu ${tag}` })).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(3);
});

test("add opposition placeholders by shirt number", async ({ page }) => {
  const name = `Rivals ${tag}`;
  await addTeam(page, name, { opposition: true });
  await expect(page.getByText("Opposition team", { exact: true })).toBeVisible();
  await page.getByLabel("Shirt numbers").fill("1-11, 14");
  await page.getByRole("button", { name: "Add players" }).click();
  const section = page.getByRole("region", { name: "Placeholder players" });
  await expect(section.getByRole("status")).toHaveText("12 placeholder players added.");
  await expect(page.getByLabel("Shirt numbers")).toBeFocused();
  await expect(page.getByLabel("Shirt numbers")).toHaveValue("");
  await page.reload();
  await expect(page.getByText("1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14")).toBeVisible();
  await page.getByLabel("Shirt numbers").fill("7");
  await page.getByRole("button", { name: "Add players" }).click();
  await expect(
    page.getByText("Number 7 is already on this team. Remove it from the list and try again."),
  ).toBeVisible();
  // Opposition placeholders never show in the squad.
  await page.goto("/squad");
  await expect(page.getByRole("option", { name: `${name} (2026)` })).toHaveCount(0);
});

test("squad list, import and player form pass axe at 375, 768 and 1280", async ({ page }) => {
  test.setTimeout(180_000);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      `/squad?team=${teamId}`,
      `/squad?team=${teamId}&status=departed`,
      "/squad/teams",
      teamPath,
      `/squad/players/new?team=${teamId}`,
      thaboPath,
      `/squad/import?team=${teamId}`,
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoAxeViolations(page);
      await expectNoSideScroll(page);
    }
    // The preview step too.
    await page.goto(`/squad/import?team=${teamId}`);
    await page.getByLabel("CSV file").setInputFiles({
      name: "check.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        `First name,Last name,DOB,Number\nLwazi,Ndlovu ${tag},2011-01-01,7\nX,,bad,`,
      ),
    });
    await page.getByRole("button", { name: "Check file" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Check the preview" })).toBeVisible();
    await expectNoAxeViolations(page);
    await expectNoSideScroll(page);
    if (width < 768) {
      // Phones get cards, not the table.
      await expect(page.getByRole("region", { name: "Rows in check.csv, by line" })).toBeHidden();
      await expect(page.getByText("Line 3", { exact: true })).toBeVisible();
    }
  }
});

test("a coach can change the squad; a scout is refused", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.goto("/settings/members");
  const coachEmail = mail(`squad-coach-${tag}`);
  const scoutEmail = mail(`squad-scout-${tag}`);
  await invite(page, coachEmail, "coach");
  await invite(page, scoutEmail, "scout");

  const coach = await acceptAsNewUser(
    browser,
    (await findInviteEmail(page.context(), coachEmail)).path,
    "Squad Coach",
  );
  await coach.goto(`/squad?team=${teamId}`);
  await expect(coach.getByRole("link", { name: "Teams" })).toBeVisible();
  await expect(coach.getByRole("link", { name: "Add player" })).toBeVisible();
  await expect(coach.getByRole("link", { name: "Import from CSV" })).toBeVisible();
  await coach.getByRole("link", { name: "Sipho Dlamini" }).click();
  await expect(coach.getByRole("heading", { level: 1, name: "Sipho Dlamini" })).toBeVisible();
  await expect(coach.getByRole("button", { name: "Save changes" })).toBeVisible();
  await expect(coach.getByRole("button", { name: "Mark as departed" })).toBeVisible();
  // The coach gets the edit form, not the read-only facts.
  await expect(coach.getByLabel(/Squad number/)).toBeEditable();
  for (const path of ["/squad/players/new", "/squad/import", "/squad/teams/new"]) {
    await coach.goto(path);
    await expect(coach.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      coach.getByRole("heading", { level: 2, name: "Only owners, admins and coaches can do this" }),
    ).toHaveCount(0);
  }
  await expectNoAxeViolations(coach);

  const scout = await acceptAsNewUser(
    browser,
    (await findInviteEmail(page.context(), scoutEmail)).path,
    "Squad Scout",
  );
  await scout.goto("/squad");
  await expect(scout).toHaveURL(/\/forbidden$/);
  await scout.goto(thaboPath);
  await expect(scout).toHaveURL(/\/forbidden$/);
  expect((await scout.request.get("/squad/import/template")).status()).toBe(403);
});
