import pg from "pg";

// Direct database access for the few e2e states the UI cannot reach, such as
// an expired invitation. Set E2E_DATABASE_URL (the compose Postgres, e.g.
// postgresql://wideline:…@postgres:5432/wideline inside the Playwright
// container). Tests that need it skip without it.

export const databaseUrl = process.env.E2E_DATABASE_URL;

export async function sql<T extends pg.QueryResultRow>(text: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

/** Every e2e account's address: mail() in helpers/orgs.ts. */
export const E2E_EMAIL_DOMAIN = "@e2e.wideline.localhost";

/**
 * Teams the specs add to Wideline Demo FC, each named with a unique() tag:
 * squad (U15 E2E, U17 CSV, Rivals), consent (U14 Consent), matches (U13
 * Matches, Rivals Matches), upload (U14 Upload, Rivals Upload), playback
 * (U12 Playback, Rivals Playback) and the C09 pipeline (U11 Pipeline, Rivals
 * Pipeline). Their players and matches (videos, processing jobs, CV output and
 * clips cascade) go with them. Keep in step with the specs.
 */
export const E2E_TEAM_PATTERN =
  "^(U1[0-9] (Consent|Matches|E2E|CSV|Upload|Playback|Pipeline)|Rivals( Matches| Upload| Playback| Pipeline)?) [0-9a-z]{9,13}$";

const KEEP_ORGS = ["Wideline Demo FC", "Wideline Lab"];

export type CleanupCounts = Record<string, number>;

/**
 * Deletes what the e2e suite created, and nothing else, in one transaction:
 * the tagged teams in Wideline Demo FC with their matches (lineups and videos
 * cascade) and players (consent rows cascade); invitations to e2e addresses;
 * organisations named "E2E …" or applied for from an e2e address (everything
 * in them cascades); and the e2e users with their sessions, accounts,
 * memberships and scout profiles. Never the seeded admin, Wideline Demo FC or
 * Wideline Lab. Object storage of deleted matches is not touched. Returns the
 * row counts; logs counts only. dryRun rolls the transaction back.
 */
export async function cleanupE2EData({
  url = databaseUrl,
  dryRun = false,
}: { url?: string; dryRun?: boolean } = {}): Promise<CleanupCounts> {
  if (!url) throw new Error("E2E_DATABASE_URL is not set");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const counts: CleanupCounts = {};
  const run = async (key: string, text: string, values: unknown[] = []) => {
    counts[key] = (await client.query(text, values)).rowCount ?? 0;
  };
  const count = async (key: string, text: string, values: unknown[] = []) => {
    counts[key] = Number((await client.query<{ n: string }>(text, values)).rows[0]?.n ?? 0);
  };
  const userIds = `SELECT id FROM "User" WHERE email LIKE '%' || $1 AND email <> $2`;
  const userArgs = [E2E_EMAIL_DOMAIN, process.env.SEED_ADMIN_EMAIL ?? "admin@wideline.localhost"];
  try {
    await client.query("BEGIN");
    await client.query(
      `CREATE TEMP TABLE e2e_team ON COMMIT DROP AS
         SELECT t.id, t."organisationId" FROM "Team" t
           JOIN "Organisation" o ON o.id = t."organisationId"
          WHERE o.name = 'Wideline Demo FC' AND t.name ~ $1`,
      [E2E_TEAM_PATTERN],
    );
    await run(
      "matches",
      `DELETE FROM "Match" m USING e2e_team t
        WHERE m."organisationId" = t."organisationId"
          AND (m."homeTeamId" = t.id OR m."awayTeamId" = t.id)`,
    );
    await run(
      "players",
      `DELETE FROM "Player" p USING e2e_team t
        WHERE p."organisationId" = t."organisationId" AND p."teamId" = t.id`,
    );
    await run(
      "teams",
      `DELETE FROM "Team" x USING e2e_team t WHERE x."organisationId" = t."organisationId" AND x.id = t.id`,
    );
    await run(`invitations`, `DELETE FROM "Invitation" WHERE email LIKE '%' || $1`, [
      E2E_EMAIL_DOMAIN,
    ]);
    await client.query(
      `CREATE TEMP TABLE e2e_org ON COMMIT DROP AS
         SELECT id FROM "Organisation"
          WHERE (name LIKE 'E2E %' OR "applicantEmail" LIKE '%' || $1)
            AND name <> ALL($2::text[])`,
      [E2E_EMAIL_DOMAIN, KEEP_ORGS],
    );
    // Teams, players and matches first: their foreign keys restrict, so the
    // organisation's own cascade could trip over them.
    await run(
      "orgMatches",
      `DELETE FROM "Match" WHERE "organisationId" IN (SELECT id FROM e2e_org)`,
    );
    await run(
      "orgPlayers",
      `DELETE FROM "Player" WHERE "organisationId" IN (SELECT id FROM e2e_org)`,
    );
    await run("orgTeams", `DELETE FROM "Team" WHERE "organisationId" IN (SELECT id FROM e2e_org)`);
    await run("organisations", `DELETE FROM "Organisation" WHERE id IN (SELECT id FROM e2e_org)`);
    await count(
      "memberships",
      `SELECT count(*) AS n FROM "Membership" WHERE "userId" IN (${userIds})`,
      userArgs,
    );
    await count(
      "sessions",
      `SELECT count(*) AS n FROM "Session" WHERE "userId" IN (${userIds})`,
      userArgs,
    );
    await count(
      "scoutProfiles",
      `SELECT count(*) AS n FROM "ScoutProfile" WHERE "userId" IN (${userIds})`,
      userArgs,
    );
    await run("verifications", `DELETE FROM "Verification" WHERE identifier LIKE '%' || $1`, [
      E2E_EMAIL_DOMAIN,
    ]);
    // Memberships, sessions, accounts and scout profiles cascade.
    await run("users", `DELETE FROM "User" WHERE id IN (${userIds})`, userArgs);
    await client.query(dryRun ? "ROLLBACK" : "COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
  console.log(`e2e cleanup${dryRun ? " (dry run, rolled back)" : ""}: ${JSON.stringify(counts)}`);
  return counts;
}
