// No "server-only" marker: the worker's review sweep (plain Node) locks matches too.

/** The one raw query a transaction client needs: $queryRaw, not tenant-scoped. */
type RawQuery = {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

/**
 * Match row locks (C10, A-6). Raw SQL is not scoped, so both filter by
 * organisationId by hand.
 *
 * A review claim (src/server/review/claims.ts) takes FOR UPDATE on the match
 * and then reads its lineup for the represented-player conflict check. Lineup
 * and marker saves take FOR SHARE first: a save either commits before the
 * claim reads the lineup, or waits and then sees In review (locked). Shared
 * locks do not block each other, so two lineup saves still run side by side.
 */
export async function lockMatchShared(
  tx: RawQuery,
  organisationId: string,
  matchId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT 1 FROM "Match" WHERE "id" = ${matchId} AND "organisationId" = ${organisationId} FOR SHARE`;
}

/** FOR UPDATE on the match row, for status moves (claims, releases, expiry). */
export async function lockMatchForUpdate(
  tx: RawQuery,
  organisationId: string,
  matchId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT 1 FROM "Match" WHERE "id" = ${matchId} AND "organisationId" = ${organisationId} FOR UPDATE`;
}
