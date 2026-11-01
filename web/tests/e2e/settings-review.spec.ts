import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Browser } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers/a11y";
import { databaseUrl, sql } from "./helpers/db";
import { acceptAsNewUser, DEMO, mail, unique } from "./helpers/orgs";

// C11 (REVIEW10; docs/build/design/C11.md, Surface 6): an admin of Wideline
// Demo FC changes the shot threshold and sees it saved; a coach sees the
// values read-only, with only the Review tab. The two members join through
// invitations written to the database (E2E_DATABASE_URL), so the spec needs
// no seeded password; the teardown deletes the e2e users. Demo FC's settings
// are put back afterwards. Axe at 375, 768 and 1280.

test.skip(!databaseUrl, "Set E2E_DATABASE_URL to write the invitations");

const WIDTHS = [375, 768, 1280];
let demoId = "";
let before: unknown = {};

/** An invitation to Demo FC for a new e2e user, accepted in a fresh context. */
async function member(browser: Browser, role: "admin" | "coach") {
  const tag = unique();
  const token = randomBytes(24).toString("base64url");
  await sql(
    `INSERT INTO "Invitation" (id, "organisationId", email, role, "tokenHash", "expiresAt")
     VALUES ($1, $2, $3, $4, $5, now() + interval '1 day')`,
    [
      `e2e${tag}`,
      demoId,
      mail(`thresholds-${role}-${tag}`),
      role,
      createHash("sha256").update(token).digest("hex"),
    ],
  );
  return acceptAsNewUser(browser, `/invite/${token}`, `E2E Thresholds ${role} ${tag}`);
}

test.beforeAll(async () => {
  const [demo] = await sql<{ id: string; settings: unknown }>(
    `SELECT id, settings FROM "Organisation" WHERE name = $1`,
    [DEMO],
  );
  demoId = demo!.id;
  before = demo!.settings;
});

test.afterAll(async () => {
  if (demoId) {
    await sql(`UPDATE "Organisation" SET settings = $2::jsonb WHERE id = $1`, [
      demoId,
      JSON.stringify(before ?? {}),
    ]);
  }
});

test("an admin saves the shot threshold; a coach reads them", async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = await member(browser, "admin");
  await admin.goto("/settings/review");
  await expect(admin.getByRole("heading", { level: 1, name: "Review settings" })).toBeVisible({
    timeout: 60_000,
  });
  const nav = admin.getByRole("navigation", { name: "Settings" });
  await expect(nav.getByRole("link")).toHaveText(["Organisation", "Members", "Review"]);
  await expect(nav.getByRole("link", { name: "Review" })).toHaveAttribute("aria-current", "page");
  await admin.getByLabel("Shots").fill("0.65");
  await admin.getByLabel("Touches").fill("0.4");
  await expect(
    admin.getByText("At 0.4, most touches are accepted without a scout checking them."),
  ).toBeVisible();
  await admin.getByRole("button", { name: "Save thresholds" }).click();
  await expect(admin.getByRole("status").filter({ hasText: "Thresholds saved." })).toBeVisible();
  await admin.reload();
  await expect(admin.getByLabel("Shots")).toHaveValue("0.65");
  const [row] = await sql<{ shot: number }>(
    `SELECT (settings->'autoAccept'->>'shot')::float AS shot FROM "Organisation" WHERE id = $1`,
    [demoId],
  );
  expect(row!.shot).toBe(0.65);

  // A value that is not a score: the field error, with focus on it.
  await admin.getByLabel("Goals").fill("1.5");
  await admin.getByRole("button", { name: "Save thresholds" }).click();
  await expect(admin.getByText("Enter a number from 0.00 to 1.00.")).toBeVisible();
  await expect(admin.getByLabel("Goals")).toBeFocused();
  for (const width of WIDTHS) {
    await admin.setViewportSize({ width, height: 900 });
    await expectNoAxeViolations(admin);
  }
  await admin.context().close();

  const coach = await member(browser, "coach");
  await coach.goto("/settings/review");
  await expect(coach.getByRole("heading", { level: 1, name: "Review settings" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(coach.getByRole("navigation", { name: "Settings" }).getByRole("link")).toHaveText([
    "Review",
  ]);
  await expect(coach.getByRole("textbox")).toHaveCount(0);
  await expect(coach.getByRole("button", { name: "Save thresholds" })).toHaveCount(0);
  await expect(coach.getByText("Only owners and admins can change these.")).toBeVisible();
  const facts = coach.locator("dl.wl-facts");
  await expect(facts).toContainText("Shots");
  await expect(facts).toContainText("0.65");
  for (const width of WIDTHS) {
    await coach.setViewportSize({ width, height: 900 });
    await expectNoAxeViolations(coach);
  }
  await coach.context().close();
});
