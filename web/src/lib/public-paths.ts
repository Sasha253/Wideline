/**
 * Paths that never need a session: sign-in, the pilot application, invitation
 * links and the API (route handlers check their own auth). Whole segments only,
 * so /applications or /invites are not public by accident.
 */
const PUBLIC_PATH = /^\/(?:login|apply|invite|api)(?:\/|$)/;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH.test(pathname);
}
