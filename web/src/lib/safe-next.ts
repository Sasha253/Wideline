/**
 * A same-site path to redirect to after sign-in, or the fallback. Accepts only
 * a path that starts with one "/" not followed by "/" or "\", and holds no
 * control characters. Browsers read "//evil.com" and "/\evil.com" as another
 * host, so both are refused, which closes the login open redirect.
 */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (!next) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  return /^\/(?![/\\])/.test(next) ? next : fallback;
}
