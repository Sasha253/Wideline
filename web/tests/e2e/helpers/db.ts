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
