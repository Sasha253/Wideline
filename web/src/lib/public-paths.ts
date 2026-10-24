/**
 * Paths that never need a session: sign-in, the pilot application, scout
 * registration, invitation links, guardian consent links (C05: the token is the
 * capability) and the API (route handlers check their own auth). Whole segments only,
 * so /applications, /invites or /consents are not public by accident.
 */
const PUBLIC_PATH = /^\/(?:login|apply|register|invite|consent|api)(?:\/|$)/;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH.test(pathname);
}
