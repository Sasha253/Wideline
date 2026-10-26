import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers/a11y";
import { requireAdminPassword, signInAsAdmin } from "./helpers/auth";
import { databaseUrl, sql } from "./helpers/db";
import { addTeam, createMatch } from "./helpers/matches";
import { DEMO, switchTo, unique } from "./helpers/orgs";
import { deletePrefix, putHlsFixture, storageConfigured } from "./helpers/storage";

// C07 acceptance (MATCH06, NFR03, NFR25; docs/build/design/C07.md, Surfaces 1
// to 3): a match with prepared footage plays in the Watch section. Playback
// starts in under 3 s from pressing Play, the time display moves, the keyboard
// drives the player, the quality menu lists the ladder, and the page passes
// axe and lays out at 375, 768 and 1280.
//
// The match is seeded as a finished transcode leaves it: an accepted Video
// row with its manifest and a succeeded ProcessingJob (E2E_DATABASE_URL), and
// the HLS fixture in object storage (`make fixtures`; keys from .env through
// `make test-e2e`). Needs the compose stack.

test.describe.configure({ mode: "serial" });
test.skip(!!process.env.CI, "Needs the compose stack: object storage behind Caddy");
test.skip(!databaseUrl, "Set E2E_DATABASE_URL to seed the transcoded match");
test.skip(!storageConfigured, "Run through `make test-e2e` so the S3 keys are passed in");

const tag = unique();
const ownName = `U12 Playback ${tag}`;
const oppName = `Rivals Playback ${tag}`;
let matchPath = "";
let prefix = "";

/** Seeds an accepted, transcoded video for the match. Returns its HLS prefix. */
async function seedTranscoded(matchId: string): Promise<string> {
  const [m] = await sql<{ organisationId: string }>(
    `SELECT "organisationId" FROM "Match" WHERE id = $1`,
    [matchId],
  );
  const org = m!.organisationId;
  const videoId = `e2e${unique()}`;
  const hls = `orgs/${org}/matches/${matchId}/hls/${videoId}/`;
  await sql(
    `INSERT INTO "Video" (id, "organisationId", "matchId", status, "blobPath", "fileName",
       "contentType", "sizeBytes", "partSize", fingerprint, "uploadedAt", "rawExpiresAt",
       "probedAt", "durationSec", width, height, fps, codec, "hlsManifestPath", "updatedAt")
     VALUES ($1, $2, $3, 'accepted', $4, 'playback.mp4', 'video/mp4', 5351043, 8388608, $5,
       now(), now() + interval '7 days', now(), 20, 1920, 1080, 25, 'h264', $6, now())`,
    [
      videoId,
      org,
      matchId,
      `orgs/${org}/matches/${matchId}/raw/${videoId}.mp4`,
      videoId,
      `${hls}master.m3u8`,
    ],
  );
  await sql(`UPDATE "Match" SET status = 'processing' WHERE id = $1`, [matchId]);
  await sql(
    `INSERT INTO "ProcessingJob" (id, "organisationId", "matchId", "videoId", type, status,
       "bossJobId", attempts, "startedAt", "finishedAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'transcode', 'succeeded', $5, 1, now(), now(), now())`,
    [`e2e${unique()}`, org, matchId, videoId, randomUUID()],
  );
  await putHlsFixture(hls);
  return hls;
}

const player = (page: Page) => page.getByRole("group", { name: /^Match video: / });

test.beforeEach(async ({ page }) => {
  requireAdminPassword();
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAsAdmin(page, "/organisations");
  await switchTo(page, DEMO);
});

test.afterAll(async () => {
  if (prefix) await deletePrefix(prefix);
});

test("a prepared match plays in under 3 s with keyboard control and a quality menu", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const ownId = await addTeam(page, ownName);
  await addTeam(page, oppName, true);
  matchPath = await createMatch(page, { home: ownId, awayLabel: `${oppName} (2026)` });
  prefix = await seedTranscoded(matchPath.split("/").pop()!);

  await page.goto(matchPath);
  await expect(page.getByRole("heading", { level: 2, name: "Watch" })).toBeVisible();
  await expect(page.getByText("Preparing playback · Ready")).toBeVisible();
  await expect(page.getByText("You can watch the match below.")).toBeVisible();
  await expect(page.getByText("Finding events · Waiting to start")).toBeVisible();

  const group = player(page);
  await expect(group).toHaveAttribute("aria-roledescription", "video player");
  const play = group.getByRole("button", { name: "Play", exact: true });
  await expect(play).toBeEnabled({ timeout: 15_000 });
  await expect(group.locator(".wl-videoplayer__time")).toHaveText("0:00 / 0:20");
  await expect(group.getByRole("slider", { name: "Seek" })).toHaveAttribute(
    "aria-valuetext",
    "0:00 of 0:20",
  );

  // NFR03: from the click on Play to the video's first `playing` event.
  await page.evaluate(() => {
    const w = window as unknown as { clickAt?: number; playingAt?: Promise<number> };
    const video = document.querySelector<HTMLVideoElement>(".wl-videoplayer video")!;
    const button = document.querySelector<HTMLButtonElement>(
      '.wl-videoplayer button[aria-label="Play"]',
    )!;
    button.addEventListener("click", () => (w.clickAt = performance.now()), {
      capture: true,
      once: true,
    });
    w.playingAt = new Promise((resolve) =>
      video.addEventListener("playing", () => resolve(performance.now()), { once: true }),
    );
  });
  await play.click();
  const startMs = await page.evaluate(async () => {
    const w = window as unknown as { clickAt: number; playingAt: Promise<number> };
    return (await w.playingAt) - w.clickAt;
  });
  console.log(`playback started ${Math.round(startMs)} ms after Play`);
  expect(startMs).toBeLessThan(3000);

  const pause = group.getByRole("button", { name: "Pause", exact: true });
  await expect(pause).toBeVisible();
  await expect(group.locator(".wl-videoplayer__time")).toHaveText(/^0:0[1-9] \/ 0:20$/, {
    timeout: 10_000,
  });

  // Keyboard, with focus in the player: Space on the focused button pauses,
  // → moves 5 s, M mutes.
  await pause.focus();
  await page.keyboard.press("Space");
  await expect(group.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  const before = await group.getByRole("slider", { name: "Seek" }).inputValue();
  await page.keyboard.press("ArrowRight");
  await expect(group.getByRole("slider", { name: "Seek" })).toHaveValue(String(Number(before) + 5));
  await page.keyboard.press("m");
  await expect(group.getByRole("button", { name: "Mute" })).toHaveAttribute("aria-pressed", "true");
  await expect(group.locator('[aria-live="polite"]')).toHaveText("Muted.");
  await page.keyboard.press("k");
  await expect(group.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.keyboard.press("k");

  // The quality menu lists Auto and the three renditions, highest first.
  const quality = group.getByRole("button", { name: "Quality: Auto" });
  await quality.click();
  const items = group.locator(".wl-videoplayer__menu .wl-popover__item");
  await expect(items).toHaveText(["Auto", "1080p", "720p", "480p"]);
  await expect(items.first()).toBeFocused();
  await expect(items.first()).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(group.getByRole("button", { name: "Quality: 720p" })).toBeFocused();
  await expect(group.locator('[aria-live="polite"]')).toHaveText("Quality set to 720p.");
  await expect(page.getByText("Keyboard shortcuts")).toBeVisible();

  await expectNoAxeViolations(page);

  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const bar = group.locator(".wl-videoplayer__bar");
    // The bar fits its row: nothing scrolls sideways.
    expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    if (width === 375) {
      for (const b of await bar.getByRole("button").all()) {
        const box = (await b.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
      expect((await group.getByRole("slider", { name: "Seek" }).boundingBox())!.height).toBe(44);
    }
    await page.screenshot({
      path: test.info().outputPath(`watch-${width}.png`),
      fullPage: true,
    });
  }
});

test("the playlist route checks the session and is never cached", async ({ page }) => {
  test.skip(!matchPath, "Needs the seeded match from the first test");
  const id = matchPath.split("/").pop()!;
  // Same organisation: 200, never cached.
  const own = await page.request.get(`/api/matches/${id}/hls/master.m3u8`);
  expect(own.status()).toBe(200);
  expect(own.headers()["cache-control"]).toBe("no-store, private");
  // Signed out: 401.
  const anon = await page.context().browser()!.newContext();
  const base = process.env.E2E_BASE_URL ?? "http://wideline.localhost";
  const res = await anon.request.get(`${base}/api/matches/${id}/hls/master.m3u8`);
  expect(res.status()).toBe(401);
  await anon.close();
});
