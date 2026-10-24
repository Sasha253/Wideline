// Squad field lists, copy and parsers shared by the server schemas
// (src/server/squad/fields.ts), the CSV import and the client forms
// (docs/build/design/C04.md). Client-safe: no zod, no server code.

/** Positions, stored as the code and shown as the label (C04 design, "Labels"). */
export const POSITIONS = [
  { code: "GK", label: "Goalkeeper" },
  { code: "RB", label: "Right-back" },
  { code: "CB", label: "Centre-back" },
  { code: "LB", label: "Left-back" },
  { code: "RWB", label: "Right wing-back" },
  { code: "LWB", label: "Left wing-back" },
  { code: "DM", label: "Defensive midfielder" },
  { code: "CM", label: "Central midfielder" },
  { code: "AM", label: "Attacking midfielder" },
  { code: "RM", label: "Right midfielder" },
  { code: "LM", label: "Left midfielder" },
  { code: "RW", label: "Right winger" },
  { code: "LW", label: "Left winger" },
  { code: "ST", label: "Striker" },
] as const;

export type PositionCode = (typeof POSITIONS)[number]["code"];

export const POSITION_LABELS: Record<string, string> = Object.fromEntries(
  POSITIONS.map((p) => [p.code, p.label]),
);

/** The label for a stored position; an unknown legacy value shows as stored. */
export function positionLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return POSITION_LABELS[code] ?? code;
}

export const AGE_GROUPS = [
  "U7",
  "U8",
  "U9",
  "U10",
  "U11",
  "U12",
  "U13",
  "U14",
  "U15",
  "U16",
  "U17",
  "U18",
  "U19",
  "U20",
  "U21",
  "Senior",
];

export const GENDERS = ["Boys", "Girls", "Men", "Women", "Mixed"];

/** "2026" or "2026/27" (the second year follows the first). */
export const SEASON_PATTERN = /^(\d{4})(?:\/(\d{2}))?$/;

export const SQUAD_NUMBER_MIN = 1;
export const SQUAD_NUMBER_MAX = 99;
export const HEIGHT_MIN_CM = 100;
export const HEIGHT_MAX_CM = 230;
export const AGE_MIN = 4;
export const AGE_MAX = 60;
export const NAME_MAX = 60;
export const TEAM_NAME_MAX = 80;
export const TEAM_LABEL_MAX = 20;

/**
 * CSV import input caps, not plan limits: they keep the server action body
 * under Next's 1 MB limit (the text travels to the server twice). Not
 * entitlement keys.
 */
export const CSV_MAX_BYTES = 512 * 1024;
export const CSV_MAX_ROWS = 500;

// Team form copy (C04 design, Surface 4).
export const TEAM_NAME_REQUIRED = "Enter a team name, for example U15 Boys.";
export const TEAM_NAME_TOO_LONG = "Use 80 characters or fewer.";
export const TEAM_LABEL_TOO_LONG = "Use 20 characters or fewer.";
export const SEASON_INVALID = "Enter a season like 2026 or 2026/27.";
export const teamNameTaken = (name: string, season: string) =>
  `You already have a team called ${name} in ${season}. Use another name or season.`;

// Player copy (C04 design, Surface 5). The CSV import uses the same sentences.
export const FIRST_NAME_REQUIRED = "Enter a first name.";
export const LAST_NAME_REQUIRED = "Enter a last name.";
export const PLAYER_NAME_TOO_LONG = "Use 60 characters or fewer.";
export const DOB_REQUIRED = "Enter a date of birth.";
export const DOB_NOT_REAL_FORM = "Enter a real date, for example 14/03/2011.";
export const DOB_UNREADABLE = "Use a date like 14/03/2011 or 2011-03-14.";
export const dobNotReal = (raw: string) => `${raw} is not a real date.`;
export const DOB_FUTURE = "This date is in the future. Check the year.";
export const dobAgeOutOfRange = (age: number) =>
  `This makes the player ${age} years old. Check the year: players are ${AGE_MIN} to ${AGE_MAX}.`;
export const POSITION_INVALID = "Use a code such as GK, CB, CM or ST, or leave it blank.";
export const FOOT_INVALID = "Use Left, Right or Both, or L, R or B.";
export const HEIGHT_INVALID = "Use centimetres from 100 to 230, for example 172.";
export const SQUAD_NUMBER_INVALID = "Use a whole number from 1 to 99.";
export const SQUAD_NUMBER_NEEDS_TEAM = "Choose a team first, or leave the number blank.";
export const OPPOSITION_TEAM_CHOSEN =
  "Choose one of your club's teams. Opposition teams hold unnamed players only.";
export const playerDeparted = (name: string) =>
  `${name} has left the club, so their details can no longer be changed.`;
export const playerNotDeparted = (name: string) => `${name} is already in the squad.`;
export const departureUndoExpired = (firstName: string) =>
  `${firstName} left more than ${DEPARTURE_UNDO_DAYS} days ago, so the departure can no longer be undone.`;

// Placeholder players (C04 design, Surface 4).
export const SHIRT_NUMBERS_REQUIRED = "Enter at least one shirt number.";
export const SHIRT_NUMBERS_INVALID =
  "Use numbers from 1 to 99, separated by commas, for example 1-11, 14.";

/** "Number 7 is already on this team. …" or "Numbers 7 and 9 are already on this team. …" */
export function shirtNumbersTaken(numbers: number[]): string {
  const tail = "Remove it from the list and try again.";
  if (numbers.length === 1) return `Number ${numbers[0]} is already on this team. ${tail}`;
  const list = joinAnd(numbers.map(String));
  return `Numbers ${list} are already on this team. Remove them from the list and try again.`;
}

/** "a", "a and b", "a, b and c". */
export function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Whole number from a trimmed string of digits only, or null. */
export function wholeNumber(raw: string): number | null {
  return /^\d{1,6}$/.test(raw) ? Number(raw) : null;
}

/**
 * Shirt numbers from "1-11, 14": comma, semicolon or space separated, with
 * ascending ranges. Sorted and without duplicates. "empty" when nothing was
 * entered, "invalid" for anything outside 1 to 99 or not a number.
 */
export function parseShirtNumbers(raw: string): number[] | "empty" | "invalid" {
  const parts = raw
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "empty";
  const out = new Set<number>();
  for (const part of parts) {
    const range = /^(\d{1,2})[-–](\d{1,2})$/.exec(part);
    const [from, to] = range ? [Number(range[1]), Number(range[2])] : [wholeNumber(part), null];
    if (from === null) return "invalid";
    const end = to ?? from;
    if (from < SQUAD_NUMBER_MIN || end > SQUAD_NUMBER_MAX || end < from) return "invalid";
    for (let n = from; n <= end; n++) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

export type DateParse = { ok: true; date: Date } | { ok: false; reason: "unreadable" | "not_real" };

/**
 * A date of birth as typed: YYYY-MM-DD, YYYY/MM/DD or DD/MM/YYYY (also with
 * hyphens or dots), never month first. Returns a UTC midnight Date, which is
 * how a @db.Date column reads back.
 */
export function parseDateOfBirth(raw: string): DateParse {
  const v = raw.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v);
  const dayFirst = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (dayFirst) {
    [d, m, y] = [Number(dayFirst[1]), Number(dayFirst[2]), Number(dayFirst[3])];
  } else {
    return { ok: false, reason: "unreadable" };
  }
  // A month over 12 in the second place is a month-first date, which we never read.
  if (m > 12 && d <= 12) return { ok: false, reason: "unreadable" };
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    m < 1 ||
    d < 1 ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return { ok: false, reason: "not_real" };
  }
  return { ok: true, date };
}

const sastDay = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Africa/Johannesburg",
});

/** Today in South Africa as a UTC midnight Date, comparable with a date of birth. */
export function todayUtc(now = new Date()): Date {
  const [y, m, d] = sastDay.format(now).split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

/** Today in South Africa as YYYY-MM-DD, for a date input's max. */
export function todayIso(now = new Date()): string {
  return sastDay.format(now);
}

/** Whole years between a date of birth (UTC midnight) and today in South Africa. */
export function ageOn(dob: Date, now = new Date()): number {
  const today = todayUtc(now);
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < dob.getUTCMonth() ||
    (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * Days after a departure during which the club can undo it (SQUAD09, Q-012).
 * A product rule, not a plan limit: it is the same for every organisation.
 */
export const DEPARTURE_UNDO_DAYS = 7;

/** The last moment a departure can be undone: departedAt plus DEPARTURE_UNDO_DAYS. */
export function departureUndoDeadline(departedAt: Date): Date {
  return new Date(departedAt.getTime() + DEPARTURE_UNDO_DAYS * 24 * 60 * 60 * 1000);
}

/** True while a departure can still be undone. */
export function canUndoDeparture(departedAt: Date | null, now = new Date()): boolean {
  return departedAt !== null && now.getTime() <= departureUndoDeadline(departedAt).getTime();
}
