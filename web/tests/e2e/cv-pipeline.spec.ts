import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers/a11y";
import { requireAdminPassword, signInAsAdmin } from "./helpers/auth";
import { databaseUrl, sql } from "./helpers/db";
import { addTeam, createMatch } from "./helpers/matches";
import { DEMO, switchTo, unique } from "./helpers/orgs";

// C09 acceptance, locally ("synthetic end-to-end goes from upload, to
// processing, to events in the database"): footage uploaded on the match page
// is probed, transcoded and sent to the cv-dispatcher, whose docker provider
// runs the wideline-cv-worker image in synthetic mode; the callback, ingest
// and the clips job follow, and the match shows Awaiting review with "Clips
// ready". The Events and Clips rows are checked in the database.
//
// Needs the whole compose stack, the cv-worker image (`make cv-image`) and
// ffmpeg in the workers; skipped in CI like upload.spec.ts. The footage comes
// from `make fixtures`.

test.describe.configure({ mode: "serial" });
test.skip(!!process.env.CI, "Needs the compose stack, the cv-worker image and the workers");

const FOOTAGE = "tests/fixtures/footage-1080p.mp4";
const tag = unique();

async function panelReady(page: Page) {
  await expect(page.locator('[data-upload-ready="true"]')).toBeAttached();
}

test("upload to review-ready through the synthetic CV pipeline and the clips job", async ({
  page,
}) => {
  test.setTimeout(15 * 60_000);
  requireAdminPassword();
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAsAdmin(page, "/organisations");
  await switchTo(page, DEMO);
  const ownId = await addTeam(page, `U11 Pipeline ${tag}`);
  await addTeam(page, `Rivals Pipeline ${tag}`, true);
  const path = await createMatch(page, {
    home: ownId,
    awayLabel: `Rivals Pipeline ${tag} (2026)`,
    halfLength: "10",
  });

  await page.goto(`${path}/upload`);
  await panelReady(page);
  await page.locator('input[type="file"]').setInputFiles(FOOTAGE);
  await page.getByRole("button", { name: "Start upload" }).click();
  await expect(page).toHaveURL(/\/matches\/[^/?]+\?done=uploaded/, { timeout: 120_000 });

  // Probe, transcode, the cv container, ingest and clips: the page polls.
  await expect(page.getByText("Cutting clips ·", { exact: false })).toBeVisible({
    timeout: 120_000,
  });
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByText("Clips ready", { exact: false }).isVisible();
      },
      { timeout: 10 * 60_000, intervals: [15_000] },
    )
    .toBe(true);
  await expect(page.getByText("Awaiting review").first()).toBeVisible();
  await expectNoAxeViolations(page);

  if (databaseUrl) {
    const matchId = path.split("/").pop()!;
    const [events] = await sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM "Event" WHERE "matchId" = $1`,
      [matchId],
    );
    const [clips] = await sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM "Clip" WHERE "matchId" = $1`,
      [matchId],
    );
    const [job] = await sql<{ modelVersion: string }>(
      `SELECT "modelVersion" FROM "ProcessingJob" WHERE "matchId" = $1 AND type = 'cv'`,
      [matchId],
    );
    expect(Number(events!.n)).toBeGreaterThan(0);
    expect(Number(clips!.n)).toBe(Number(events!.n));
    expect(job!.modelVersion).toMatch(/^synthetic-1\+/);
  }
});
