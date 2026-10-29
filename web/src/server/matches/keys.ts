// Object keys for a match (C06, C07). No "server-only" marker: the worker
// (plain Node, src/worker/) builds the same keys, and that package throws
// outside a React server build. Pure; no client or secret.

/** orgs/{organisationId}/matches/{matchId}/: everything stored for a match. */
export function matchPrefix(organisationId: string, matchId: string): string {
  return `orgs/${organisationId}/matches/${matchId}/`;
}

/**
 * C08: where a CV attempt writes its result, under the match prefix so a match
 * deletion purges it: orgs/{org}/matches/{match}/cv/{jobId}/attempt-{n}/result.json.
 */
export function cvResultKey(
  organisationId: string,
  matchId: string,
  jobId: string,
  attempt: number,
): string {
  return `${matchPrefix(organisationId, matchId)}cv/${jobId}/attempt-${attempt}/result.json`;
}

/**
 * C09: the calibration still a CV attempt saves for the Lab (PNG), next to its
 * result: orgs/{org}/matches/{match}/cv/{jobId}/attempt-{n}/still.png. C17
 * removes stills with the rest of cv/.
 */
export function cvStillKey(
  organisationId: string,
  matchId: string,
  jobId: string,
  attempt: number,
): string {
  return `${matchPrefix(organisationId, matchId)}cv/${jobId}/attempt-${attempt}/still.png`;
}
