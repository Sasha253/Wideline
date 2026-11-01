import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers/a11y";
import { adminPassword, signInAsAdmin } from "./helpers/auth";
import { databaseUrl, sql } from "./helpers/db";
import { findEmailLink } from "./helpers/mailpit";
import { DEMO, mail, switchTo, unique } from "./helpers/orgs";

// C10: the review queue, claim confirmation and claimed match
// (docs/build/design/C10.md). A scout registers and confirms through the UI; the
// approval and the reviewable matches are written straight to the database
// (E2E_DATABASE_URL), in Wideline Demo FC with tagged teams that the global
// teardown deletes. Axe at 375, 768 and 1280 px on every C10 screen.

const WIDTHS = [375, 768, 1280];
const HOUR = 60 * 60 * 1000;
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

const adultId = () => saId(`800101${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`);
const id = () => `e2e${unique()}${Math.random().toString(36).slice(2, 8)}`;

type Seeded = { matchId: string; home: string; away: string };

/** A Demo FC match awaiting review, with an accepted video whose raw footage expires in `hours`. */
async function seedMatch(orgId: string, hours: number, away: string): Promise<Seeded> {
  const home = `U10 Review ${unique()}`;
  const [homeId, awayId, matchId, videoId] = [id(), id(), id(), id()];
  await sql(
    `INSERT INTO "Team" (id, "organisationId", name, season, "ageGroup", "isOpposition", "updatedAt")
     VALUES ($1, $3, $4, '2026', 'U10', false, now()), ($2, $3, $5, '2026', NULL, true, now())`,
    [homeId, awayId, orgId, home, away],
  );
  await sql(
    `INSERT INTO "Match" (id, "organisationId", "homeTeamId", "awayTeamId", "playedAt", competition,
                          status, "halfLengthMinutes", "updatedAt")
     VALUES ($1, $2, $3, $4, now() - interval '2 days', 'E2E league', 'awaiting_review', 35, now())`,
    [matchId, orgId, homeId, awayId],
  );
  const expires = new Date(Date.now() + hours * HOUR);
  await sql(
    `INSERT INTO "Video" (id, "organisationId", "matchId", status, "blobPath", "fileName",
                          "contentType", "sizeBytes", "partSize", fingerprint, "uploadedAt",
                          "rawExpiresAt", "durationSec", "updatedAt")
     VALUES ($1, $2, $3, 'accepted', $4, 'match.mp4', 'video/mp4', 1000, 1000, $1,
             $5::timestamptz - interval '7 days', $5::timestamptz, 4200, now())`,
    [videoId, orgId, matchId, `orgs/${orgId}/matches/${matchId}/raw/${videoId}.mp4`, expires],
  );
  return { matchId, home, away };
}

const waitingTable = (page: Page) =>
  page.getByRole("region", {
    name: "Matches waiting for a reviewer, soonest footage deletion first",
  });

test("queue, claim, claimed page, release: end to end", async ({ browser }) => {
  test.skip(!databaseUrl, "Set E2E_DATABASE_URL to seed the review fixtures");
  // Registration, three axe sweeps and two claims: slow on a loaded dev machine.
  test.setTimeout(420_000);

  // A scout who declared one club: "Review {tag}" blocks the match against "Rivals Review {tag}".
  const tag = unique();
  const scout = { name: `E2E Reviewer ${tag}`, email: mail(`reviewer-${tag}`) };
  const blockedTeam = `Rivals Review ${unique()}`;
  const blockedClub = blockedTeam.replace(/^Rivals /, "");

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto("/register");
  await page.locator("#step-1").getByLabel("Your name").fill(scout.name);
  await page.locator("#step-1").getByLabel("Email").fill(scout.email);
  await page.locator("#step-1").getByLabel("Mobile number").fill("082 123 4567");
  await page.locator("#step-1").getByRole("button", { name: "Continue" }).click();
  await page
    .locator("#step-2")
    .getByRole("radio", { name: /South African ID/ })
    .check();
  await page.locator("#step-2").getByLabel("ID number").fill(adultId());
  await page.locator("#step-2").getByRole("button", { name: "Continue" }).click();
  await page.locator("#step-3").getByLabel("Club name").fill(blockedClub);
  await page.locator("#step-3").getByRole("button", { name: "Continue" }).click();
  await page
    .locator("#step-4")
    .getByRole("checkbox", { name: /I am 18 or older/ })
    .check();
  await page.locator("#step-4").getByRole("button", { name: "Register as a scout" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeVisible();
  const { url } = await findEmailLink(
    context,
    scout.email,
    "Confirm your email for Wideline",
    VERIFY_LINK,
  );
  await page.goto(url);
  await expect(page).toHaveURL(/\/scout\?registered=1/);
  await sql(
    `UPDATE "ScoutProfile" SET status = 'approved', "verifiedAt" = now(), "reviewedAt" = now()
      WHERE "userId" = (SELECT id FROM "User" WHERE email = $1)`,
    [scout.email],
  );

  const [demo] = await sql<{ id: string }>(`SELECT id FROM "Organisation" WHERE name = $1`, [DEMO]);
  const demoId = demo!.id;
  const danger = await seedMatch(demoId, 20, `Rivals Review ${unique()}`);
  const later = await seedMatch(demoId, 60, `Rivals Review ${unique()}`);
  const blocked = await seedMatch(demoId, 40, blockedTeam);

  // 1. The queue: soonest deletion first, time left on every row, the conflicted row has no Claim.
  await page.goto("/review");
  await expect(page.getByRole("heading", { level: 1, name: "Review queue" })).toBeVisible();
  await expect(page.getByText("You can hold 1 claimed match at a time.")).toBeVisible();
  const rows = waitingTable(page).getByRole("row");
  const texts = await rows.allTextContents();
  const at = (s: Seeded) => texts.findIndex((t) => t.includes(s.home));
  expect(at(danger)).toBeGreaterThan(0);
  expect(at(danger)).toBeLessThan(at(blocked));
  expect(at(blocked)).toBeLessThan(at(later));
  const dangerRow = rows.filter({ hasText: danger.home });
  await expect(dangerRow.locator(".wl-xchip--urgent")).toContainText(/1[89] hours/);
  const blockedRow = rows.filter({ hasText: blocked.home });
  await expect(blockedRow.getByText("You cannot claim this match")).toBeVisible();
  await expect(blockedRow.getByRole("link", { name: /^Claim/ })).toHaveCount(0);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoAxeViolations(page);
  }

  // 2. Cards under 768px: the table is hidden, each match is a card with full names.
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(waitingTable(page)).toBeHidden();
  const card = page.locator("li.wl-queue-card").filter({ hasText: danger.home });
  await expect(card).toBeVisible();
  await expect(card.getByRole("link", { name: /^Claim/ })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });

  // 3. Claim: the declaration is required, then the claimed page.
  await dangerRow.getByRole("link", { name: /^Claim/ }).click();
  // A cold dev server compiles each new route on first visit: allow for it.
  await expect(page).toHaveURL(new RegExp(`/review/matches/${danger.matchId}/claim`), {
    timeout: 60_000,
  });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(danger.home);
  await expect(page.getByText("Times are South African time.")).toBeVisible();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoAxeViolations(page);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Claim match" }).click();
  const declaration = page.getByRole("checkbox", {
    name: "I have no link to either club or to any player in this match.",
  });
  await expect(
    page.getByText("Confirm that you have no link to either club or to any player in this match."),
  ).toBeVisible();
  await expect(declaration).toBeFocused();
  await declaration.check();
  await page.getByRole("button", { name: "Claim match" }).click();
  await expect(page).toHaveURL(/\/review\/claims\/[^/?]+\?done=claimed/, { timeout: 60_000 });
  await expect(page.getByRole("status").filter({ hasText: "Match claimed." })).toBeVisible();
  await expect(page.locator(".wl-chip").filter({ hasText: "Claimed" })).toBeVisible();
  const claimedUrl = page.url().replace(/\?.*$/, "");
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoAxeViolations(page);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // 4. The queue now shows Your claimed match, and Claim is disabled with the limit note.
  await page.goto("/review");
  await expect(page.getByRole("heading", { name: /Your claimed match/ })).toBeVisible();
  await expect(page.locator("#review-limit-note")).toContainText(
    "Finish or release your claimed match to claim another.",
  );
  const laterClaim = waitingTable(page)
    .getByRole("row")
    .filter({ hasText: later.home })
    .getByRole("button", { name: /^Claim/ });
  await expect(laterClaim).toBeDisabled();
  await expect(laterClaim).toHaveAttribute("aria-describedby", "review-limit-note");

  // 5. The club sees that a scout is reviewing and when it is due, never who.
  // Needs the seeded admin's password; without it this step is skipped loudly.
  if (!adminPassword) {
    console.warn("review.spec: club page step SKIPPED, set E2E_PASSWORD (or SEED_ADMIN_PASSWORD)");
    test.info().annotations.push({ type: "skipped step", description: "club page due time" });
  } else {
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await signInAsAdmin(admin, "/organisations");
    await switchTo(admin, DEMO);
    await admin.goto(`/matches/${danger.matchId}`);
    await expect(
      admin.getByText(/A scout is reviewing this match\. The review is due by/),
    ).toBeVisible();
    await expect(admin.getByText(scout.name)).toHaveCount(0);
    await adminContext.close();
  }

  // 6. Release through the dialog: back to the queue with the notice.
  await page.goto(claimedUrl);
  await page.getByRole("button", { name: "Release match" }).click();
  const dialog = page.getByRole("dialog", { name: "Release this match?" });
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Release match" }).click();
  await expect(page).toHaveURL(/\/review\?done=released/, { timeout: 60_000 });
  await expect(page.getByRole("status").filter({ hasText: "Match released." })).toBeVisible();

  // 7. Keyboard only at 1280: claim the later match.
  await page.goto(`/review/matches/${later.matchId}/claim`);
  const box = page.getByRole("checkbox", {
    name: "I have no link to either club or to any player in this match.",
  });
  for (let i = 0; i < 40 && !(await box.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(box).toBeFocused();
  await page.keyboard.press("Space");
  await expect(box).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Claim match" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/review\/claims\/[^/?]+\?done=claimed/, { timeout: 60_000 });

  await context.close();
});
