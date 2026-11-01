import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers/a11y";
import { databaseUrl, sql } from "./helpers/db";
import { findEmailLink } from "./helpers/mailpit";
import { DEMO, mail, unique } from "./helpers/orgs";
import { deletePrefix, putHlsFixture, storageConfigured } from "./helpers/storage";

// C11 acceptance (REVIEW03 to REVIEW09, REVIEW11; docs/build/design/C11.md): a
// scout works through a claimed match in the review workspace. The keyboard
// only path: J and K move, Y confirms, N rejects, E opens the edit dialog and
// it is saved, then Tab and Enter reach "Mark as reviewed", which publishes
// the match and ends the claim. On the way: the watermark shows the scout's
// name, a track is linked from the track-link editor (every event on it moves
// to the player), a missed event is added at the playhead, and axe passes at
// 375, 768 and 1280. The match (Wideline Demo FC, tagged teams the teardown
// deletes), its HLS fixture in object storage, the cv job, a track and the
// events are seeded directly (E2E_DATABASE_URL, `make test-e2e` for the S3 keys).

test.skip(!!process.env.CI, "Needs the compose stack: object storage behind Caddy");
// Under `make test-e2e` (it sets E2E_BASE_URL) a missing DB URL or S3 key is a
// failure, not a skip, so a misconfigured run cannot pass as a skip.
const viaMake = !!process.env.E2E_BASE_URL;
test.skip(!viaMake && !databaseUrl, "Set E2E_DATABASE_URL to seed the claimed match");
test.skip(
  !viaMake && !storageConfigured,
  "Run through `make test-e2e` so the S3 keys are passed in",
);
test.beforeAll(() => {
  expect(databaseUrl, "E2E_DATABASE_URL must be set").toBeTruthy();
  expect(storageConfigured, "the E2E_S3_* keys must be set").toBe(true);
});

const WIDTHS = [375, 768, 1280];
const VERIFY_LINK = /https?:\/\/\S+\/api\/auth\/verify-email\?\S+/;
const id = () => `e2e${unique()}${Math.random().toString(36).slice(2, 8)}`;

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

/** Registers a scout through the UI (signed in after the email link) and approves them. */
async function registerScout(page: Page, name: string, email: string) {
  await page.goto("/register");
  await page.locator("#step-1").getByLabel("Your name").fill(name);
  await page.locator("#step-1").getByLabel("Email").fill(email);
  await page.locator("#step-1").getByLabel("Mobile number").fill("082 123 4567");
  await page.locator("#step-1").getByRole("button", { name: "Continue" }).click();
  await page
    .locator("#step-2")
    .getByRole("radio", { name: /South African ID/ })
    .check();
  await page
    .locator("#step-2")
    .getByLabel("ID number")
    .fill(saId(`800101${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`));
  await page.locator("#step-2").getByRole("button", { name: "Continue" }).click();
  await page.locator("#step-3").getByRole("button", { name: "Continue" }).click();
  await page
    .locator("#step-4")
    .getByRole("checkbox", { name: /I am 18 or older/ })
    .check();
  await page.locator("#step-4").getByRole("button", { name: "Register as a scout" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeVisible();
  const { url } = await findEmailLink(
    page.context(),
    email,
    "Confirm your email for Wideline",
    VERIFY_LINK,
  );
  await page.goto(url);
  await expect(page).toHaveURL(/\/scout\?registered=1/);
  await sql(
    `UPDATE "ScoutProfile" SET status = 'approved', "verifiedAt" = now(), "reviewedAt" = now()
      WHERE "userId" = (SELECT id FROM "User" WHERE email = $1)`,
    [email],
  );
}

type Seeded = {
  matchId: string;
  home: string;
  prefix: string;
  trackIndex: number;
  events: string[];
};

/** A Demo FC match awaiting review, with HLS, a cv job, a lineup, a track and four events. */
async function seedMatch(orgId: string): Promise<Seeded> {
  const tag = unique();
  const home = `U10 Review ${tag}`;
  const away = `Rivals Review ${tag}`;
  const [homeId, awayId, matchId, videoId, jobId, trackId] = [id(), id(), id(), id(), id(), id()];
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
  const prefix = `orgs/${orgId}/matches/${matchId}/hls/${videoId}/`;
  await sql(
    `INSERT INTO "Video" (id, "organisationId", "matchId", status, "blobPath", "fileName",
                          "contentType", "sizeBytes", "partSize", fingerprint, "uploadedAt",
                          "rawExpiresAt", "durationSec", width, height, "hlsManifestPath", "updatedAt")
     VALUES ($1, $2, $3, 'accepted', $4, 'match.mp4', 'video/mp4', 1000, 1000, $1,
             now() - interval '2 days', now() + interval '5 days', 20, 1920, 1080, $5, now())`,
    [
      videoId,
      orgId,
      matchId,
      `orgs/${orgId}/matches/${matchId}/raw/${videoId}.mp4`,
      `${prefix}master.m3u8`,
    ],
  );
  await putHlsFixture(prefix);
  await sql(
    `INSERT INTO "ProcessingJob" (id, "organisationId", "matchId", "videoId", type, status,
                                  "bossJobId", attempts, "startedAt", "finishedAt", metadata, "updatedAt")
     VALUES ($1, $2, $3, $4, 'cv', 'succeeded', $5, 1, now(), now(),
             '{"teamSideEvidence": {"kept": 0, "swapped": 0}, "teamSideSwapped": false}', now())`,
    [jobId, orgId, matchId, videoId, randomUUID()],
  );
  // Two named, scout-visible home players in the lineup.
  for (const [n, first] of [
    [7, "Thabo"],
    [9, "Sipho"],
  ] as const) {
    const playerId = id();
    await sql(
      `INSERT INTO "Player" (id, "organisationId", "teamId", "firstName", "lastName", "updatedAt")
       VALUES ($1, $2, $3, $4, 'Reviewtest', now())`,
      [playerId, orgId, homeId, first],
    );
    await sql(
      `INSERT INTO "Consent" (id, "organisationId", "playerId", state, "clubStats", "scoutVisible",
                              "grantedBy", relationship, method, "wordingVersion", "playerWasMinor", "grantedAt")
       VALUES ($1, $2, $3, 'scout_visible', true, true, 'Thandi Guardian', 'parent', 'paper_form',
               'test', true, now())`,
      [id(), orgId, playerId],
    );
    await sql(
      `INSERT INTO "Lineup" (id, "organisationId", "matchId", "teamId", "playerId", "shirtNumber")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id(), orgId, matchId, homeId, playerId, n],
    );
  }
  const trackIndex = 22;
  await sql(
    `INSERT INTO "Track" (id, "organisationId", "matchId", "jobId", "trackIndex", "teamSide", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'home', now())`,
    [trackId, orgId, matchId, jobId, trackIndex],
  );
  const events: string[] = [];
  const rows: [number, string, string | null, string][] = [
    [2000, "pending_review", trackId, "shot"],
    [6000, "pending_review", trackId, "shot"],
    [10_000, "pending_review", null, "touch"],
    [14_000, "auto_accepted", null, "touch"],
  ];
  for (const [t, status, track, type] of rows) {
    const eventId = id();
    events.push(eventId);
    await sql(
      `INSERT INTO "Event" (id, "organisationId", "matchId", "jobId", "sourceKey", type, status,
                            "teamSide", "trackId", "timestampMs", confidence, "clipStartMs", "clipEndMs", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'home', $8, $9, $10, $11, $12, now())`,
      [
        eventId,
        orgId,
        matchId,
        jobId,
        `${type}@${t}#${eventId}`,
        type,
        status,
        track,
        t,
        status === "auto_accepted" ? 0.95 : 0.6,
        Math.max(0, t - 2000),
        t + 2000,
      ],
    );
  }
  return { matchId, home, prefix, trackIndex, events };
}

const eventRows = (page: Page) => page.getByRole("list", { name: "Events" }).getByRole("listitem");
const currentRow = (page: Page) =>
  page.getByRole("list", { name: "Events" }).locator('li[aria-current="true"]');

/** Presses Tab until `target` has focus (at most 60 times). */
async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 60; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

test("review workspace: keyboard-only review, relink, missed event, publish", async ({
  browser,
}) => {
  // Registration, three axe sweeps and a cold dev server: slow on a loaded machine.
  test.setTimeout(480_000);
  const tag = unique();
  const scout = { name: `E2E Workspace ${tag}`, email: mail(`workspace-${tag}`) };
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await registerScout(page, scout.name, scout.email);

  const [demo] = await sql<{ id: string }>(`SELECT id FROM "Organisation" WHERE name = $1`, [DEMO]);
  const m = await seedMatch(demo!.id);
  try {
    // Claim it.
    await page.goto(`/review/matches/${m.matchId}/claim`);
    await page.getByRole("button", { name: "Claim match" }).click();
    await page
      .getByRole("checkbox", {
        name: "I have no link to either club or to any player in this match.",
      })
      .check();
    await page.getByRole("button", { name: "Claim match" }).click();
    await expect(page).toHaveURL(/\/review\/claims\/[^/?]+\?done=claimed/, { timeout: 60_000 });
    const claimUrl = page.url().replace(/\?.*$/, "");

    // 1. The workspace: watermark, three events to check, the first pending selected.
    const review = page.getByRole("region", { name: "Review" });
    await expect(page.getByRole("heading", { level: 2, name: "Review" })).toBeVisible();
    const watermark = page.getByTestId("review-watermark");
    await expect(watermark).toBeVisible();
    await expect(watermark).toContainText(scout.name);
    await expect(watermark).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByText("0 of 3 checked")).toBeVisible();
    await expect(eventRows(page)).toHaveCount(3);
    await expect(currentRow(page)).toContainText("0:02");
    await expect(
      review.getByText("Times are match times.").or(page.getByText(/so times are video times/)),
    ).toBeVisible();
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoAxeViolations(page);
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    // 2. Keyboard only: J and K move, Y confirms, N rejects, E edits.
    await page.locator("body").focus();
    await page.keyboard.press("j");
    await expect(currentRow(page)).toContainText("0:06");
    await page.keyboard.press("k");
    await expect(currentRow(page)).toContainText("0:02");
    await page.keyboard.press("y");
    await expect(page.getByText("1 of 3 checked")).toBeVisible();
    // Auto-advance to the next pending event.
    await expect(currentRow(page)).toContainText("0:06");
    await page.keyboard.press("n");
    await expect(page.getByText("2 of 3 checked")).toBeVisible();
    await expect(currentRow(page)).toContainText("0:10");
    await page.keyboard.press("e");
    const edit = page.getByRole("dialog", { name: "Edit event" });
    await expect(edit).toBeVisible();
    // Focus starts on the first field (Goal); Space picks it, Tab reaches Save.
    await page.keyboard.press("Space");
    await tabTo(page, edit.getByRole("button", { name: "Save and confirm" }));
    await page.keyboard.press("Enter");
    await expect(edit).toBeHidden();
    await expect(page.getByText("All 3 checked")).toBeVisible();
    // The DB holds every decision as a correction with previous and new values.
    const kinds = await sql<{ kind: string }>(
      `SELECT kind::text AS kind FROM "EventCorrection" WHERE "matchId" = $1 ORDER BY "correctedAt"`,
      [m.matchId],
    );
    expect(kinds.map((k) => k.kind)).toEqual(["confirmed", "rejected", "edited"]);

    // 3. The track-link editor, keyboard only: link track 22 to #7 Thabo, which moves both its events.
    await tabTo(page, page.getByRole("tab", { name: /^Tracks/ }));
    await page.keyboard.press("Enter");
    await tabTo(page, page.getByRole("button", { name: `Link player to track ${m.trackIndex}` }));
    await page.keyboard.press("Enter");
    const linkDialog = page.getByRole("dialog", { name: `Link track ${m.trackIndex}` });
    const player = linkDialog.getByLabel("Player");
    await tabTo(page, player);
    // A native select: selectOption on the focused control is what the arrow keys do.
    await player.selectOption({ label: "#7 Thabo Reviewtest" });
    await expect(linkDialog.getByText("This moves 2 events to #7 Thabo Reviewtest.")).toBeVisible();
    await tabTo(page, linkDialog.getByRole("button", { name: "Link track" }));
    await page.keyboard.press("Enter");
    await expect(linkDialog).toBeHidden();
    await expect(page.getByRole("list", { name: "Tracks" })).toContainText("#7 Thabo Reviewtest");
    const moved = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM "Event" e JOIN "Player" p ON p.id = e."playerId"
        WHERE e."matchId" = $1 AND p."firstName" = 'Thabo'`,
      [m.matchId],
    );
    expect(moved[0]!.n).toBe(2);
    await tabTo(page, page.getByRole("tab", { name: /^Events/ }));
    await page.keyboard.press("Enter");
    await expect(eventRows(page).filter({ hasText: "#7 Thabo Reviewtest" })).toHaveCount(2);

    // 4. Add a missed event at the playhead, keyboard only.
    await tabTo(page, page.getByRole("button", { name: "Add missed event" }));
    await page.keyboard.press("Enter");
    const panel = page.getByRole("region", { name: "Add missed event" });
    await expect(panel.getByLabel("Video time")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("0:12.0");
    await tabTo(page, panel.getByRole("radio", { name: "Touch" }));
    await page.keyboard.press("Space");
    await expect(panel.getByRole("radio", { name: "Touch" })).toBeChecked();
    await tabTo(page, panel.getByRole("button", { name: "Add event" }));
    await page.keyboard.press("Enter");
    await expect(panel).toBeHidden();
    await expect(eventRows(page)).toHaveCount(4);
    await expect(currentRow(page)).toContainText("0:12");

    // 5. Tab and Enter to Mark as reviewed, then confirm in the dialog.
    const submit = page
      .getByTestId("review-header")
      .getByRole("button", { name: "Mark as reviewed" });
    await tabTo(page, submit);
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("dialog", { name: "Mark this match as reviewed?" });
    await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await tabTo(page, confirm.getByRole("button", { name: "Mark as reviewed" }));
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\?done=submitted/, { timeout: 60_000 });
    await expect(page.getByText("You marked this match as reviewed. Thank you.")).toBeVisible();
    const [match] = await sql<{ status: string; published: boolean }>(
      `SELECT status::text AS status, "publishedAt" IS NOT NULL AS published FROM "Match" WHERE id = $1`,
      [m.matchId],
    );
    expect(match).toEqual({ status: "published", published: true });

    // 6. Access ended: the playlist route answers 404 now (REVIEW11).
    const claimId = claimUrl.split("/").pop()!;
    const res = await page.request.get(`/api/review/claims/${claimId}/hls/master.m3u8`);
    expect(res.status()).toBe(404);
  } finally {
    await deletePrefix(m.prefix).catch(() => undefined);
    await context.close();
  }
});
