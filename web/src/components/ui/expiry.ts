/**
 * Footage expiry rules for ExpiryBanner and ExpiryLabel. Pure, so they can be
 * unit tested with a fixed clock.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export type ExpiryLevel = "none" | "warning" | "danger";

/**
 * More than 72h left: none. From 72h down to 24h: warning. Under 24h, or
 * already past: danger.
 */
export function expiryLevel(expiresAt: Date, now: Date): ExpiryLevel {
  const left = expiresAt.getTime() - now.getTime();
  if (left > 72 * HOUR) return "none";
  if (left >= 24 * HOUR) return "warning";
  return "danger";
}

/**
 * Time left in words. Floors, so it never overstates the time left:
 * "3 days", "1 day", "23 hours", "1 hour", "under 1 hour".
 */
export function formatTimeLeft(ms: number): string {
  if (ms >= DAY) {
    const days = Math.floor(ms / DAY);
    return days === 1 ? "1 day" : `${days} days`;
  }
  if (ms >= HOUR) {
    const hours = Math.floor(ms / HOUR);
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return "under 1 hour";
}

const deletionDate = new Intl.DateTimeFormat("en-ZA", {
  weekday: "long",
  day: "numeric",
  month: "short",
  timeZone: "Africa/Johannesburg",
});

/**
 * "Friday 24 Oct". Built from parts, because format() puts a comma after the
 * weekday in en-ZA.
 */
export function formatDeletionDate(date: Date): string {
  const parts = deletionDate.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}`;
}
