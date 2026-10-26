import { cleanupE2EData, databaseUrl } from "./helpers/db";

// After every e2e run: delete what the suite created (users, organisations,
// and the tagged teams, players and matches in Wideline Demo FC), so the dev
// database does not fill up with test rows. Only with E2E_DATABASE_URL.
export default async function globalTeardown() {
  if (!databaseUrl) {
    console.warn("e2e cleanup: skipped, E2E_DATABASE_URL is not set");
    return;
  }
  await cleanupE2EData();
}
