import { expect, type Page } from "@playwright/test";

// Match helpers for the C06 specs: teams through the squad pages and a match
// through the create-match form, as a club owner would make them.

/** Adds a 2026 team and returns its id. */
export async function addTeam(page: Page, name: string, opposition = false): Promise<string> {
  await page.goto(opposition ? "/squad/teams/new?kind=opposition" : "/squad/teams/new");
  await page.getByLabel("Team name").fill(name);
  await page.getByLabel("Season").fill("2026");
  await page.getByRole("button", { name: "Add team" }).click();
  await expect(page).toHaveURL(/\/squad\/teams\/[^/?]+\?done=created/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

/** Creates a match from the form and returns its path, /matches/<id>. */
export async function createMatch(
  page: Page,
  { home, awayLabel, halfLength = "45" }: { home: string; awayLabel: string; halfLength?: string },
): Promise<string> {
  await page.goto(`/matches/new?team=${home}`);
  await page.getByLabel("Away team").selectOption({ label: awayLabel });
  await page.getByLabel("Half length (min)").fill(halfLength);
  await page.getByRole("button", { name: "Create match" }).click();
  await expect(page).toHaveURL(/\/matches\/[^/?]+\?done=created/);
  return new URL(page.url()).pathname;
}
