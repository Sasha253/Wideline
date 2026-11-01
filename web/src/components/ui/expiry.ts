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

/*
 * Floodlight steps (Patterns, "Expiry banner"): colour, icon and wording change together.
 * More than 3 days: neutral. 3 days or less: pending. Under 24 hours: urgent (role=alert).
 * Deleted: lock. The countdown updates once a minute and never ticks seconds.
 */
export type ExpiryStep = "neutral" | "pending" | "urgent" | "deleted";

const MINUTE = 60 * 1000;

/** The step for a deletion time. Past the time (or with `deleted`) it is "deleted". */
export function expiryStep(deletesAt: Date, now: Date, deleted = false): ExpiryStep {
  const left = deletesAt.getTime() - now.getTime();
  if (deleted || left <= 0) return "deleted";
  if (left > 72 * HOUR) return "neutral";
  if (left >= 24 * HOUR) return "pending";
  return "urgent";
}

/**
 * The compact countdown, floored to the minute: "12 d", "1 d 22 h", "8 h 41 m", "12 m".
 * Days drop the hours from 3 days up, as in the design ("12 d").
 */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / MINUTE));
  const days = Math.floor(total / (24 * 60));
  const hours = Math.floor((total % (24 * 60)) / 60);
  const minutes = total % 60;
  if (days >= 3) return `${days} d`;
  if (days >= 1) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours >= 1) return `${hours} h ${minutes} m`;
  return `${Math.max(1, minutes)} m`;
}

/** The countdown in words for screen readers: "1 day 22 hours", "8 hours 41 minutes". */
export function formatCountdownWords(ms: number): string {
  const unit = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const total = Math.max(0, Math.floor(ms / MINUTE));
  const days = Math.floor(total / (24 * 60));
  const hours = Math.floor((total % (24 * 60)) / 60);
  const minutes = total % 60;
  if (days >= 3) return unit(days, "day");
  if (days >= 1)
    return hours > 0 ? `${unit(days, "day")} ${unit(hours, "hour")}` : unit(days, "day");
  if (hours >= 1) return `${unit(hours, "hour")} ${unit(minutes, "minute")}`;
  return unit(Math.max(1, minutes), "minute");
}

/** Time left rounded to the nearest whole unit, for sentences: "2 days", "9 hours". */
export function formatRoughTimeLeft(ms: number): string {
  if (ms >= DAY) {
    const days = Math.max(1, Math.round(ms / DAY));
    return days === 1 ? "1 day" : `${days} days`;
  }
  if (ms >= HOUR) {
    const hours = Math.max(1, Math.round(ms / HOUR));
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return "under 1 hour";
}

const longDate = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Johannesburg",
});

/** "12 Nov 2026". Built from parts, so no locale punctuation creeps in. */
export function formatExpiryDate(date: Date): string {
  const parts = longDate.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  // en-ZA pads the day ("03 Nov") in some ICU versions; the design writes "3 Nov".
  return `${Number(part("day"))} ${part("month")} ${part("year")}`;
}

/** The banner's first sentence for a step (exact strings from the design). */
export function expiryLead(step: ExpiryStep, deletesAt: Date, now: Date): string {
  const left = deletesAt.getTime() - now.getTime();
  switch (step) {
    case "neutral":
      return `Raw footage for this match is kept until ${formatExpiryDate(deletesAt)}.`;
    case "pending":
    case "urgent":
      return `Raw footage for this match is deleted in ${formatRoughTimeLeft(left)}.`;
    case "deleted":
      return `Raw footage was deleted on ${formatExpiryDate(deletesAt)}.`;
  }
}

/** The banner's default consequence after the lead, by step. */
export const EXPIRY_CONSEQUENCE: Record<ExpiryStep, string> = {
  neutral: "",
  pending: "Review it before then to add missed events.",
  urgent: "After that, missed events can't be added.",
  deleted: "Confirmed clips are kept. Missed events can no longer be added.",
};
