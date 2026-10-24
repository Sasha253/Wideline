import { expect, test, type Page, type Route } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers/a11y";
import { requireAdminPassword, signInAsAdmin } from "./helpers/auth";
import { addTeam, createMatch } from "./helpers/matches";
import { DEMO, switchTo, unique } from "./helpers/orgs";

// C06 acceptance (MATCH02, NFR26): an upload interrupted at about 50% resumes
// without sending again what arrived; a reload resumes from the same point;
// 720p footage is rejected with guidance; accepted footage takes markers
// (docs/build/design/C06.md, Surfaces 3, 5 and 6).
//
// Needs the compose stack: RustFS behind Caddy (CORS for the browser PUTs) and
// the worker for the ffprobe check. The footage comes from `make fixtures`.

test.describe.configure({ mode: "serial" });
test.skip(!!process.env.CI, "Needs the compose stack: object storage, Caddy CORS and the worker");

const FOOTAGE_1080P = "tests/fixtures/footage-1080p.mp4";
const FOOTAGE_720P = "tests/fixtures/footage-720p.mp4";
const tag = unique();
const ownName = `U14 Upload ${tag}`;
const oppName = `Rivals Upload ${tag}`;
let ownId = "";
let acceptedPath = "";

/** Every storage PUT, by part number, with whether it went through. */
type PutLog = { part: number; sent: boolean }[];

/**
 * Routes the browser's part PUTs: part 1 always goes through; the others are
 * aborted (a dropped connection) while `block.on` is true.
 */
async function routeParts(page: Page, log: PutLog, block: { on: boolean }) {
  await page.route("**/raw/**", async (route: Route) => {
    const req = route.request();
    if (req.method() !== "PUT") return route.continue();
    const part = Number(new URL(req.url()).searchParams.get("partNumber"));
    if (part !== 1 && block.on) {
      log.push({ part, sent: false });
      return route.abort("connectionreset");
    }
    log.push({ part, sent: true });
    return route.continue();
  });
}

const sentCount = (log: PutLog, part: number) =>
  log.filter((p) => p.part === part && p.sent).length;

test.beforeEach(async ({ page }) => {
  requireAdminPassword();
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAsAdmin(page, "/organisations");
  await switchTo(page, DEMO);
  // Leaving a running upload asks first (beforeunload); the reload case accepts.
  page.on("dialog", (d) => void d.accept());
});

test("a dropped connection at 50% retries and completes without resending part 1", async ({
  page,
}) => {
  test.setTimeout(180_000);
  ownId = await addTeam(page, ownName);
  await addTeam(page, oppName, true);
  acceptedPath = await createMatch(page, {
    home: ownId,
    awayLabel: `${oppName} (2026)`,
    halfLength: "10",
  });

  const log: PutLog = [];
  const block = { on: true };
  await routeParts(page, log, block);
  await page.goto(`${acceptedPath}/upload`);
  await expect(page.getByRole("heading", { level: 2, name: "Choose the recording" })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.locator('input[type="file"]').setInputFiles(FOOTAGE_1080P);
  await expect(page.getByText("footage-1080p.mp4", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start upload" }).click();

  await expect(page.getByRole("heading", { level: 2, name: "Uploading" })).toBeVisible();
  await expect(page.getByText("Connection lost. Retrying in", { exact: false })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
  await expectNoAxeViolations(page);
  await page.screenshot({
    path: test.info().outputPath("upload-retrying-1280.png"),
    fullPage: true,
  });
  expect(sentCount(log, 1)).toBe(1);

  block.on = false;
  await page.getByRole("button", { name: "Retry now" }).click();
  await expect(page).toHaveURL(/\/matches\/[^/?]+\?done=uploaded/, { timeout: 60_000 });
  await expect(page.getByRole("status").filter({ hasText: "Upload complete." })).toBeVisible();
  // Part 1 went once, in the first attempt; 2 and 3 after the connection came back.
  expect(sentCount(log, 1)).toBe(1);
  expect(sentCount(log, 2)).toBe(1);
  expect(sentCount(log, 3)).toBe(1);
  expect(log.filter((p) => !p.sent).length).toBeGreaterThan(0);
});

test("a reload mid-upload resumes from the same point with the same file", async ({ page }) => {
  test.setTimeout(180_000);
  const path = await createMatch(page, { home: ownId, awayLabel: `${oppName} (2026)` });
  const log: PutLog = [];
  const block = { on: true };
  await routeParts(page, log, block);
  await page.goto(`${path}/upload`);
  await page.locator('input[type="file"]').setInputFiles(FOOTAGE_1080P);
  await page.getByRole("button", { name: "Start upload" }).click();
  await expect(page.getByText("Connection lost. Retrying in", { exact: false })).toBeVisible({
    timeout: 30_000,
  });
  expect(sentCount(log, 1)).toBe(1);

  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: "Carry on uploading" })).toBeVisible();
  await expect(
    page.getByText(
      "The upload of footage-1080p.mp4 stopped at 40%. Choose the same file to carry on from there.",
    ),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  // Another file is refused with the C06 copy.
  await page.locator('input[type="file"]').setInputFiles(FOOTAGE_720P);
  await expect(
    page.getByText(/^This is not the file you started with \(footage-1080p\.mp4/),
  ).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles(FOOTAGE_1080P);
  await expect(page.getByText("Resuming from 40%")).toBeVisible();
  block.on = false;
  // The next automatic retry may already have finished the upload.
  await page
    .getByRole("button", { name: "Retry now" })
    .click({ timeout: 2000 })
    .catch(() => {});
  await expect(page).toHaveURL(/\/matches\/[^/?]+\?done=uploaded/, { timeout: 60_000 });
  // Part 1 never went again after the reload.
  expect(sentCount(log, 1)).toBe(1);
});

test("720p footage is rejected with re-film guidance", async ({ page }) => {
  test.setTimeout(180_000);
  const path = await createMatch(page, { home: ownId, awayLabel: `${oppName} (2026)` });
  await page.goto(`${path}/upload`);
  await page.locator('input[type="file"]').setInputFiles(FOOTAGE_720P);
  // The browser pre-check reads the frame size and warns before the upload.
  await expect(
    page.getByText(
      "This video looks like 1280 × 720. Footage under 1080p is rejected after upload.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose another file" })).toHaveClass(
    /wl-btn--primary/,
  );
  await page.getByRole("button", { name: "Upload anyway" }).click();
  await expect(page).toHaveURL(/\?done=uploaded/, { timeout: 60_000 });
  // The worker checks the footage; the page polls, a reload is the same.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("This footage cannot be used.")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 90_000 });
  await expect(
    page.getByText("This video is 1280 × 720. Wideline needs at least 1080p (1920 × 1080)."),
  ).toBeVisible();
  await expect(
    page.getByText("Set the camera to 1080p or higher before the next match", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Upload footage" })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("accepted footage takes kickoff and half-time markers, typed as mm:ss", async ({ page }) => {
  test.setTimeout(180_000);
  await expect(async () => {
    await page.goto(acceptedPath);
    await expect(page.getByText(/Footage accepted/)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 90_000 });
  await expect(page.getByText("1920 × 1080")).toBeVisible();
  // No lineup yet on the own side: that is the next step.
  await expect(page.getByRole("link", { name: "Enter lineups" }).first()).toBeVisible();

  await page.goto(`${acceptedPath}/markers`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Kickoff and half-time" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Kickoff", exact: true }).fill("0:05");
  await page.getByRole("textbox", { name: "Half-time", exact: true }).fill("0:04");
  await page.getByRole("button", { name: "Save markers" }).click();
  await expect(page.getByText("Half-time must be after kickoff.")).toBeVisible();

  await page.getByRole("textbox", { name: "Half-time", exact: true }).fill("2:40");
  await page.getByRole("textbox", { name: "Second-half kickoff", exact: true }).fill("2:50");
  await page.getByRole("textbox", { name: "Full time", exact: true }).fill("5:20.5");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Save markers" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Markers saved. Match minutes now follow these times." }),
  ).toBeVisible();
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  await expectNoAxeViolations(page);
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: test.info().outputPath(`markers-${width}.png`), fullPage: true });
  }

  await page.goto(acceptedPath);
  await page.screenshot({
    path: test.info().outputPath("detail-accepted-1280.png"),
    fullPage: true,
  });
  for (const t of ["0:05", "2:40", "2:50", "5:20"]) {
    await expect(page.getByText(t, { exact: true })).toBeVisible();
  }
});
