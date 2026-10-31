/**
 * Review queue and claim rules (C10; REVIEW01, REVIEW02, REVIEW13). Pure and
 * client-safe, so the server, the worker's sweep and the pages share them and
 * unit tests can run them with a fixed clock.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A claim lasts 48 hours (REVIEW01). A product rule, not an entitlement (A-4). */
export const CLAIM_DURATION_MS = 48 * HOUR;

/** Platform admins are told when unreviewed raw footage has 48 hours or less left (REVIEW13). */
export const REVIEW_ALERT_LEAD_MS = 48 * HOUR;

/**
 * After raw deletion (7 days after upload), a match stays in the queue as
 * "Clips only" until its un-favourited clips go, 14 days after upload (Q-055).
 */
export const CLIPS_ONLY_WINDOW_MS = 7 * DAY;

/**
 * The no-conflict declaration's wording version (Q-058). Draft, for legal
 * review: new wording is a new version. Stored in the claim's audit row.
 */
export const CLAIM_DECLARATION_VERSION = "2026-10-draft-1";

/** When a claim made at `claimedAt` ends. */
export function claimEndsAt(claimedAt: Date): Date {
  return new Date(claimedAt.getTime() + CLAIM_DURATION_MS);
}

/**
 * Whether a claim still holds at `now`: active and not past its end. Every
 * check uses this, so the 48-hour boundary is exact between sweeps (A-5).
 */
export function isClaimLive(claim: { status: string; expiresAt: Date }, now: Date): boolean {
  return claim.status === "active" && claim.expiresAt.getTime() > now.getTime();
}

export type QueueSection = "waiting" | "clips_only" | "gone";

/**
 * Where a match's accepted video puts it in the queue: raw footage still
 * stored is waiting; raw footage deleted (or past its expiry) is clips only
 * until the clips go; after that it has left the queue (Q-055). A video with
 * no expiry (an upload that never finished) is not reviewable.
 */
export function queueSection(
  video: { rawExpiresAt: Date | null; deletedAt: Date | null },
  now: Date,
): QueueSection {
  if (!video.rawExpiresAt) return "gone";
  const t = now.getTime();
  const raw = video.rawExpiresAt.getTime();
  if (!video.deletedAt && raw > t) return "waiting";
  return raw + CLIPS_ONLY_WINDOW_MS > t ? "clips_only" : "gone";
}

/** When a clips-only match's clips go. */
export function clipsExpireAt(rawExpiresAt: Date): Date {
  return new Date(rawExpiresAt.getTime() + CLIPS_ONLY_WINDOW_MS);
}

type Sortable = { id: string; playedAt: Date; rawExpiresAt: Date | null };

/** Queue order (REVIEW13): soonest raw footage expiry first, then played date, then id. */
export function compareQueue(a: Sortable, b: Sortable): number {
  const ea = a.rawExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const eb = b.rawExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (ea !== eb) return ea < eb ? -1 : 1;
  const pa = a.playedAt.getTime();
  const pb = b.playedAt.getTime();
  if (pa !== pb) return pa < pb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * A name as words for comparison: accents removed (NFKD), lower case,
 * punctuation to spaces, whitespace collapsed. "Ajax-Cape Town FC." becomes
 * "ajax cape town fc".
 */
export function normaliseName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * True when `needle`'s words appear in `haystack` as a whole-word sequence,
 * after normaliseName: "Ajax Cape Town" is in "AJAX CAPE TOWN U15 Boys",
 * "Ajax" is not in "Ajaxian FC". An empty or one-letter needle never matches.
 */
export function containsWords(haystack: string, needle: string): boolean {
  const n = normaliseName(needle);
  if (n.length < 2) return false;
  const h = normaliseName(haystack);
  return ` ${h} `.includes(` ${n} `);
}
