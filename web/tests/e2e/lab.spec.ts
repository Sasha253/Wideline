import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers/a11y";
import { requireAdminPassword, signInAsAdmin } from "./helpers/auth";
import { databaseUrl, sql } from "./helpers/db";
import { DEMO, LAB, switchTo } from "./helpers/orgs";
import { s3Bucket, storageConfigured } from "./helpers/storage";

// C09 Lab pages (docs/build/design/C09.md, Surfaces 1 to 5) on the seeded
// "Benchmark" match, whose tags are the synthetic truth: the match list, the
// match benchmark view with a tag import (and the replace confirmation), the
// calibration tool (a still and a cv job are put in place when the database
// and storage are reachable) with its keyboard path, and the benchmark page.
// axe at 375, 768 and 1280. A user who is not a platform admin in the active
// organisation is sent to /forbidden.

test.describe.configure({ mode: "serial" });

const TRUTH = "tests/fixtures/cv/synthetic-truth.csv";
const WIDTHS = [375, 768, 1280];

async function benchmarkMatchId(page: Page): Promise<string> {
  await page.goto("/lab/matches");
  // The seeded match whose competition is "Benchmark" (prisma/seed.ts).
  const row = page.locator("tr", { hasText: "Benchmark" }).first();
  const href = await row.getByRole("link").first().getAttribute("href");
  return href!.split("/").pop()!;
}

/** A cv job, an accepted video and a still for the match, so calibration has something to show. */
async function stillFor(matchId: string): Promise<boolean> {
  if (!databaseUrl || !storageConfigured) return false;
  const [m] = await sql<{ organisationId: string }>(
    `SELECT "organisationId" FROM "Match" WHERE id = $1`,
    [matchId],
  );
  const org = m!.organisationId;
  let [video] = await sql<{ id: string }>(
    `SELECT id FROM "Video" WHERE "matchId" = $1 AND status = 'accepted'`,
    [matchId],
  );
  if (!video) {
    const id = `e2evid${randomUUID().slice(0, 8)}`;
    await sql(
      `INSERT INTO "Video" (id, "organisationId", "matchId", status, "blobPath", "fileName", "contentType",
         "sizeBytes", "partSize", fingerprint, width, height, "durationSec", "uploadedAt", "updatedAt")
       VALUES ($1, $2, $3, 'accepted', 'none', 'lab-still.mp4', 'video/mp4', 1, 1, $1, 1920, 1080, 90, now(), now())`,
      [id, org, matchId],
    );
    video = { id };
  }
  let [job] = await sql<{ id: string }>(
    `SELECT id FROM "ProcessingJob" WHERE "videoId" = $1 AND type = 'cv'`,
    [video.id],
  );
  if (!job) {
    const id = `e2ejob${randomUUID().slice(0, 8)}`;
    await sql(
      `INSERT INTO "ProcessingJob" (id, "organisationId", "matchId", "videoId", type, status, "bossJobId",
         attempts, "updatedAt")
       VALUES ($1, $2, $3, $4, 'cv', 'running', $5, 1, now())`,
      [id, org, matchId, video.id, randomUUID()],
    );
    job = { id };
  }
  const s3 = new S3Client({
    endpoint: process.env.E2E_S3_ENDPOINT ?? "http://s3.wideline.localhost",
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.E2E_S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.E2E_S3_SECRET_ACCESS_KEY!,
    },
  });
  // A 1 x 1 green PNG stands in for the frame.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgaGAAAAEEAQBmvSn5AAAAAElFTkSuQmCC",
    "base64",
  );
  await s3.send(
    new PutObjectCommand({
      Bucket: s3Bucket,
      Key: `orgs/${org}/matches/${matchId}/cv/${job.id}/attempt-1/still.png`,
      Body: png,
      ContentType: "image/png",
    }),
  );
  return true;
}

test.beforeEach(async ({ page }) => {
  requireAdminPassword();
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAsAdmin(page, "/organisations");
  await switchTo(page, LAB);
});

test("the Lab sub-navigation and match list", async ({ page }) => {
  await page.goto("/lab/matches");
  const nav = page.getByRole("navigation", { name: "CV Lab" });
  await expect(nav.getByRole("link", { name: "Matches" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "Matches, newest first" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Ready in" })).toBeVisible();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoAxeViolations(page);
  }
});

test("the match benchmark view takes a tag import", async ({ page }) => {
  const id = await benchmarkMatchId(page);
  await page.goto(`/lab/matches/${id}`);
  await expect(page.getByRole("heading", { level: 2, name: "Recall" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "CV Lab" }).getByRole("link", { name: "Matches" }),
  ).toHaveAttribute("aria-current", "true");
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoAxeViolations(page);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByLabel("Source").selectOption("synthetic");
  await page.getByLabel("CSV file").setInputFiles(TRUTH);
  await page.getByRole("button", { name: "Import tags" }).click();
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible()) {
    await expect(
      dialog.getByRole("heading", { name: /Replace \d+ synthetic tags\?/ }),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Replace tags" }).click();
  }
  const rows = readFileSync(TRUTH, "utf8").trim().split(/\r?\n/).length - 1;
  await expect(page.getByText(`Imported ${rows} tags`, { exact: false })).toBeVisible();
  await expect(page.getByRole("region", { name: "Recall by event type" }).first()).toBeVisible();
});

test("the calibration tool, by keyboard", async ({ page }) => {
  const id = await benchmarkMatchId(page);
  const ready = await stillFor(id);
  await page.goto(`/lab/matches/${id}/calibration`);
  await expect(page.getByRole("heading", { level: 1, name: "Pitch calibration" })).toBeVisible();
  if (!ready) {
    await expect(page.getByRole("heading", { name: "No still yet" })).toBeVisible();
    await expectNoAxeViolations(page);
    return;
  }
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoAxeViolations(page);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const add = page.getByRole("button", { name: "Add point" });
  await add.focus();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Enter");
    // Focus moves to the new point's Landmark select.
    await expect(page.getByRole("combobox", { name: "Landmark" }).nth(i)).toBeFocused();
    await add.focus();
  }
  await expect(page.getByText("Choose a landmark for every point to see the fit.")).toBeVisible();
  const landmarks = page.getByRole("combobox", { name: "Landmark" });
  await landmarks.nth(0).selectOption("corner_near_left");
  await page.getByRole("spinbutton", { name: "X (px)" }).nth(0).fill("40");
  await page.getByRole("spinbutton", { name: "Y (px)" }).nth(0).fill("1040");
  await page.getByRole("spinbutton", { name: "Y (px)" }).nth(0).press("Shift+ArrowUp");
  await expect(page.getByRole("spinbutton", { name: "Y (px)" }).nth(0)).toHaveValue("1050");
  await page.getByRole("button", { name: "Remove point 4" }).click();
  await expect(page.getByText("Place at least 4 points. 3 placed.")).toBeVisible();
  await expectNoAxeViolations(page);
});

test("the benchmark page", async ({ page }) => {
  await page.goto("/lab/benchmark");
  await expect(page.getByRole("heading", { level: 1, name: "Benchmark" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "CV Lab" }).getByRole("link", { name: "Benchmark" }),
  ).toHaveAttribute("aria-current", "page");
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoAxeViolations(page);
  }
});

test("someone who is not a platform admin here is refused", async ({ page }) => {
  await switchTo(page, DEMO);
  for (const path of ["/lab/matches", "/lab/benchmark"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/forbidden/);
  }
});
