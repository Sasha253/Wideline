// Object keys for a match (C06, C07). No "server-only" marker: the worker
// (plain Node, src/worker/) builds the same keys, and that package throws
// outside a React server build. Pure; no client or secret.

/** orgs/{organisationId}/matches/{matchId}/: everything stored for a match. */
export function matchPrefix(organisationId: string, matchId: string): string {
  return `orgs/${organisationId}/matches/${matchId}/`;
}
