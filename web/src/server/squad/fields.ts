import { z } from "zod";
import type { PreferredFoot } from "@/generated/prisma/enums";
import {
  AGE_MAX,
  AGE_MIN,
  ageOn,
  DOB_FUTURE,
  DOB_NOT_REAL_FORM,
  DOB_REQUIRED,
  DOB_UNREADABLE,
  dobAgeOutOfRange,
  dobNotReal,
  FIRST_NAME_REQUIRED,
  FOOT_INVALID,
  HEIGHT_INVALID,
  HEIGHT_MAX_CM,
  HEIGHT_MIN_CM,
  LAST_NAME_REQUIRED,
  NAME_MAX,
  parseDateOfBirth,
  PLAYER_NAME_TOO_LONG,
  POSITION_INVALID,
  POSITIONS,
  SEASON_INVALID,
  SEASON_PATTERN,
  SQUAD_NUMBER_INVALID,
  SQUAD_NUMBER_MAX,
  SQUAD_NUMBER_MIN,
  SQUAD_NUMBER_NEEDS_TEAM,
  TEAM_LABEL_MAX,
  TEAM_LABEL_TOO_LONG,
  TEAM_NAME_MAX,
  TEAM_NAME_REQUIRED,
  TEAM_NAME_TOO_LONG,
  todayUtc,
  wholeNumber,
  type PositionCode,
} from "@/lib/squad-fields";
export { departureUndoExpired, playerNotDeparted } from "@/lib/squad-fields";

export * from "@/lib/squad-fields";

// Team and player fields (SQUAD01, SQUAD02, SQUAD04, SQUAD07). The messages are
// the copy shown to people (docs/build/design/C04.md). One row validator,
// validatePlayerRow, serves the player form and every CSV row, so the two never
// disagree.

const optionalLabel = z
  .string()
  .trim()
  .max(TEAM_LABEL_MAX, { error: TEAM_LABEL_TOO_LONG })
  .optional()
  .transform((v) => (v ? v : null));

export const seasonField = z
  .string({ error: SEASON_INVALID })
  .trim()
  .refine(
    (v) => {
      const m = SEASON_PATTERN.exec(v);
      if (!m) return false;
      const year = Number(m[1]);
      if (year < 1990 || year > 2100) return false;
      return m[2] === undefined || Number(m[2]) === (year + 1) % 100;
    },
    { error: SEASON_INVALID },
  );

export const teamSchema = z.object({
  name: z
    .string({ error: TEAM_NAME_REQUIRED })
    .trim()
    .min(1, { error: TEAM_NAME_REQUIRED })
    .max(TEAM_NAME_MAX, { error: TEAM_NAME_TOO_LONG }),
  ageGroup: optionalLabel,
  gender: optionalLabel,
  season: seasonField,
});

/** Create only: whose team it is. Fixed after creation. */
export const teamKindField = z.enum(["own", "opposition"]).default("own");

export type TeamInput = z.input<typeof teamSchema>;

/** The fields of one player, as typed in the form or read from a CSV row. */
export type PlayerRowInput = {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  position?: string;
  preferredFoot?: string;
  heightCm?: string;
  squadNumber?: string;
};

export type PlayerRowField = keyof PlayerRowInput | "teamId" | "player";

/** Field names as the CSV preview shows them ("{Field}: {message}"). */
export const PLAYER_FIELD_LABELS: Record<PlayerRowField, string> = {
  firstName: "First name",
  lastName: "Last name",
  dateOfBirth: "Date of birth",
  position: "Position",
  preferredFoot: "Preferred foot",
  heightCm: "Height",
  squadNumber: "Squad number",
  teamId: "Team",
  player: "Player",
};

export type PlayerValues = {
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  position: PositionCode | null;
  preferredFoot: PreferredFoot | null;
  heightCm: number | null;
  squadNumber: number | null;
};

export type RowIssue = { field: PlayerRowField; message: string };

const FOOT_ALIASES: Record<string, PreferredFoot> = {
  left: "left",
  l: "left",
  right: "right",
  r: "right",
  both: "both",
  b: "both",
};

/** A position code, case-insensitive; the label ("Right winger") works too. */
export function parsePosition(raw: string): PositionCode | null | "invalid" {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  const hit = POSITIONS.find((p) => p.code.toLowerCase() === v || p.label.toLowerCase() === v);
  return hit ? hit.code : "invalid";
}

export function parseFoot(raw: string): PreferredFoot | null | "invalid" {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  return FOOT_ALIASES[v] ?? "invalid";
}

/** A squad number from 1 to 99, null when blank. */
export function parseSquadNumber(raw: string): number | null | "invalid" {
  const v = raw.trim();
  if (!v) return null;
  const n = wholeNumber(v);
  return n !== null && n >= SQUAD_NUMBER_MIN && n <= SQUAD_NUMBER_MAX ? n : "invalid";
}

/**
 * Checks one player. `source` picks the date copy: the form's date input always
 * sends YYYY-MM-DD, so it has one message for a bad date; the CSV says whether
 * the date was unreadable or not real. `hasTeam` is false when the form's Team
 * is "No team", which leaves no room for a squad number.
 */
export function validatePlayerRow(
  raw: PlayerRowInput,
  { source, hasTeam, now = new Date() }: { source: "form" | "csv"; hasTeam: boolean; now?: Date },
): { value: PlayerValues | null; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const report = (field: PlayerRowField, message: string) => issues.push({ field, message });
  const text = (v: string | undefined) => (v ?? "").trim();

  const firstName = text(raw.firstName);
  const lastName = text(raw.lastName);
  if (!firstName) report("firstName", FIRST_NAME_REQUIRED);
  else if (firstName.length > NAME_MAX) report("firstName", PLAYER_NAME_TOO_LONG);
  if (!lastName) report("lastName", LAST_NAME_REQUIRED);
  else if (lastName.length > NAME_MAX) report("lastName", PLAYER_NAME_TOO_LONG);

  let dateOfBirth: Date | null = null;
  const dobRaw = text(raw.dateOfBirth);
  if (!dobRaw) {
    report("dateOfBirth", DOB_REQUIRED);
  } else {
    const parsed = parseDateOfBirth(dobRaw);
    if (!parsed.ok) {
      const message =
        source === "form"
          ? DOB_NOT_REAL_FORM
          : parsed.reason === "not_real"
            ? dobNotReal(dobRaw)
            : DOB_UNREADABLE;
      report("dateOfBirth", message);
    } else if (parsed.date > todayUtc(now)) {
      report("dateOfBirth", DOB_FUTURE);
    } else {
      const age = ageOn(parsed.date, now);
      if (age < AGE_MIN || age > AGE_MAX) report("dateOfBirth", dobAgeOutOfRange(age));
      else dateOfBirth = parsed.date;
    }
  }

  const position = parsePosition(text(raw.position));
  if (position === "invalid") report("position", POSITION_INVALID);
  const preferredFoot = parseFoot(text(raw.preferredFoot));
  if (preferredFoot === "invalid") report("preferredFoot", FOOT_INVALID);

  let heightCm: number | null = null;
  const heightRaw = text(raw.heightCm).replace(/\s*cm$/i, "");
  if (heightRaw) {
    const n = wholeNumber(heightRaw);
    if (n === null || n < HEIGHT_MIN_CM || n > HEIGHT_MAX_CM) report("heightCm", HEIGHT_INVALID);
    else heightCm = n;
  }

  const squadNumber = parseSquadNumber(text(raw.squadNumber));
  if (squadNumber === "invalid") report("squadNumber", SQUAD_NUMBER_INVALID);
  else if (squadNumber !== null && !hasTeam) report("squadNumber", SQUAD_NUMBER_NEEDS_TEAM);

  if (issues.length > 0 || !dateOfBirth) return { value: null, issues };
  return {
    value: {
      firstName,
      lastName,
      dateOfBirth,
      position: position as PositionCode | null,
      preferredFoot: preferredFoot as PreferredFoot | null,
      heightCm,
      squadNumber: squadNumber as number | null,
    },
    issues,
  };
}

const formText = z.string().optional();

/** The player form: the row validator, plus the team ("" is No team). */
export const playerSchema = z
  .object({
    teamId: z.string().trim().optional(),
    firstName: formText,
    lastName: formText,
    dateOfBirth: formText,
    position: formText,
    preferredFoot: formText,
    heightCm: formText,
    squadNumber: formText,
  })
  .transform((d, ctx) => {
    const teamId = d.teamId ? d.teamId : null;
    const { value, issues } = validatePlayerRow(d, { source: "form", hasTeam: teamId !== null });
    for (const issue of issues) {
      ctx.addIssue({ code: "custom", path: [issue.field], message: issue.message });
    }
    if (!value) return z.NEVER;
    return { ...value, teamId };
  });

export type PlayerInput = z.input<typeof playerSchema>;
export type PlayerData = z.output<typeof playerSchema>;

/** One opposition placeholder (SQUAD07): a shirt number and maybe a position. No name, no date of birth. */
export const placeholderSchema = z.object({
  squadNumber: z
    .number({ error: SQUAD_NUMBER_INVALID })
    .int({ error: SQUAD_NUMBER_INVALID })
    .min(SQUAD_NUMBER_MIN, { error: SQUAD_NUMBER_INVALID })
    .max(SQUAD_NUMBER_MAX, { error: SQUAD_NUMBER_INVALID }),
  position: z
    .string()
    .optional()
    .transform((v, ctx) => {
      const p = parsePosition(v ?? "");
      if (p === "invalid") {
        ctx.addIssue({ code: "custom", message: POSITION_INVALID });
        return z.NEVER;
      }
      return p;
    }),
});
