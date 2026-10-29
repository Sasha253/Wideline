// No "server-only" marker: the clips worker (plain Node) uses it. Pure.

/** CV11: a clip is kept 14 days after its footage was uploaded, unless favourited. */
export const CLIP_RETENTION_DAYS = 14;

/**
 * Clip.baseExpiresAt and its first expiresAt: Video.uploadedAt + 14 days. A
 * favourite clears expiresAt and removing the last one restores this
 * (ClipFavourite triggers, migration c09_clips_rules). C17 deletes the file.
 */
export function clipExpiry(uploadedAt: Date): Date {
  return new Date(uploadedAt.getTime() + CLIP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}
