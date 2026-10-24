import { z } from "zod";
import { MARKER_KEYS } from "@/lib/match-clock";
import { POSITIONS } from "@/lib/squad-fields";

// Field schemas for matches, lineups, substitutions, markers and uploads, with
// the C06 copy (docs/build/design/C06.md, Surfaces 2 to 5).

export const HALF_LENGTH_DEFAULT = 45;
export const HALF_LENGTH_MIN = 10;
export const HALF_LENGTH_MAX = 60;
export const TEXT_MAX = 120;

const TEXT_TOO_LONG = "Use 120 characters or fewer.";
const HALF_LENGTH_ERROR = "Enter a half length from 10 to 60 minutes.";
export const DATE_ERROR = "Enter the match date.";

const optionalText = z
  .string()
  .trim()
  .max(TEXT_MAX, TEXT_TOO_LONG)
  .transform((v) => (v === "" ? null : v));

/**
 * A match date (YYYY-MM-DD) as a Date at midday in South Africa, so it shows
 * as the same day in Africa/Johannesburg everywhere.
 */
export const playedAtField = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, DATE_ERROR)
  .transform((v, ctx) => {
    const d = new Date(`${v}T12:00:00+02:00`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
      ctx.addIssue({ code: "custom", message: DATE_ERROR });
      return z.NEVER;
    }
    return d;
  });

export const matchSchema = z
  .object({
    homeTeamId: z.string().trim().min(1, "Choose the home team."),
    awayTeamId: z.string().trim().min(1, "Choose the away team."),
    playedAt: playedAtField,
    venue: optionalText,
    competition: optionalText,
    halfLengthMinutes: z.coerce
      .number({ error: HALF_LENGTH_ERROR })
      .int(HALF_LENGTH_ERROR)
      .min(HALF_LENGTH_MIN, HALF_LENGTH_ERROR)
      .max(HALF_LENGTH_MAX, HALF_LENGTH_ERROR),
  })
  .superRefine((v, ctx) => {
    if (v.homeTeamId && v.awayTeamId && v.homeTeamId === v.awayTeamId) {
      ctx.addIssue({
        code: "custom",
        path: ["awayTeamId"],
        message: "Choose a different team from the home team.",
      });
    }
  });

export type MatchInput = z.input<typeof matchSchema>;
export type MatchData = z.output<typeof matchSchema>;

const POSITION_CODES = POSITIONS.map((p) => p.code) as [string, ...string[]];

export const SHIRT_NUMBER_ERROR = "Enter a shirt number from 1 to 99.";

/** One selected lineup row. Unselected players are left out of the input. */
export const lineupRowSchema = z.object({
  playerId: z.string().min(1),
  isStarter: z.boolean(),
  shirtNumber: z
    .number({ error: SHIRT_NUMBER_ERROR })
    .int(SHIRT_NUMBER_ERROR)
    .min(1, SHIRT_NUMBER_ERROR)
    .max(99, SHIRT_NUMBER_ERROR),
  position: z.enum(POSITION_CODES).nullable(),
});

export type LineupRowInput = z.infer<typeof lineupRowSchema>;

/** A side can start with 11 at most; youth formats (7v7, 9v9) start fewer. */
export const MAX_STARTERS = 11;

export function tooManyStarters(n: number): string {
  return `A side can start with 11 players at most. You chose ${n}.`;
}

export function shirtNumberUsedBy(n: number, other: string): string {
  return `Shirt number ${n} is already used by ${other}.`;
}

export const substitutionSchema = z.object({
  teamId: z.string().min(1),
  offLineupId: z.string().trim().min(1, "Choose the player who came off."),
  // null: came off with no replacement (injury or red card).
  onLineupId: z.string().trim().min(1, "Choose who came on, or No replacement.").nullable(),
  minute: z.number().int(),
});

export type SubstitutionInput = z.infer<typeof substitutionSchema>;

export function minuteRangeError(max: number): string {
  return `Enter a minute from 1 to ${max}.`;
}

export const markersSchema = z.object(
  Object.fromEntries(MARKER_KEYS.map((k) => [k, z.number().int().min(0).nullable()])) as Record<
    (typeof MARKER_KEYS)[number],
    z.ZodNullable<z.ZodNumber>
  >,
);

export type MarkersInput = z.infer<typeof markersSchema>;

/** POST /api/matches/[matchId]/upload: the file the browser is about to send. */
export const uploadStartSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  size: z.number().int().min(0),
  type: z.string().max(100).default(""),
  lastModified: z.number().int().min(0),
});

export type UploadStartInput = z.input<typeof uploadStartSchema>;

export const presignSchema = z.object({
  videoId: z.string().min(1),
  partNumbers: z.array(z.number().int().min(1)).min(1).max(50),
});

export const videoIdSchema = z.object({ videoId: z.string().min(1) });
