import { z } from "zod";

/**
 * Auto-accept thresholds per event type (REVIEW10; PRD stats catalogue, v0
 * rows). A CV event at or above its type's threshold is auto_accepted; below,
 * it goes to the review queue as pending_review. Each organisation may set its
 * own under Organisation.settings.autoAccept; C11 adds the settings screen.
 * Pure, so the server and that screen share it. Thresholds are not
 * entitlements: they tune review load, they do not limit a plan.
 */

export type AutoAcceptType = "goal" | "shot" | "touch";
export type AutoAcceptThresholds = Record<AutoAcceptType, number>;

/** The stats catalogue's defaults. Set high at first (PRD page 19). */
export const AUTO_ACCEPT_DEFAULTS: AutoAcceptThresholds = { goal: 0.9, shot: 0.75, touch: 0.8 };

const threshold = z.number().min(0).max(1);
const settingsSchema = z.object({
  autoAccept: z
    .object({
      goal: threshold.optional().catch(undefined),
      shot: threshold.optional().catch(undefined),
      touch: threshold.optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});

/** The organisation's thresholds from its settings JSON, each falling back to the default. */
export function autoAcceptThresholds(settings: unknown): AutoAcceptThresholds {
  const parsed = settingsSchema.safeParse(settings ?? {});
  const own = parsed.success ? (parsed.data.autoAccept ?? {}) : {};
  return {
    goal: own.goal ?? AUTO_ACCEPT_DEFAULTS.goal,
    shot: own.shot ?? AUTO_ACCEPT_DEFAULTS.shot,
    touch: own.touch ?? AUTO_ACCEPT_DEFAULTS.touch,
  };
}

/** A CV event's status: auto_accepted at or above the threshold, else pending_review. */
export function eventStatusFor(
  type: AutoAcceptType,
  confidence: number,
  thresholds: AutoAcceptThresholds,
): "auto_accepted" | "pending_review" {
  return confidence >= thresholds[type] ? "auto_accepted" : "pending_review";
}

export const AUTO_ACCEPT_TYPES: readonly AutoAcceptType[] = ["goal", "shot", "touch"];

/** C11 (docs/build/design/C11.md, Surface 6): the one field error. */
export const THRESHOLD_ERROR = "Enter a number from 0.00 to 1.00.";

/**
 * One threshold as typed: a confidence score from 0 to 1 with at most 2
 * decimals ("0.75", ".9", "1"), the same form the review meter shows (Q-072).
 * Stored as typed: a fraction, so no conversion.
 */
const thresholdInput = z
  .string({ error: THRESHOLD_ERROR })
  .trim()
  .regex(/^(?:0?\.\d{1,2}|[01](?:\.\d{1,2})?)$/, THRESHOLD_ERROR)
  .transform(Number)
  .refine((v) => v >= 0 && v <= 1, THRESHOLD_ERROR);

/** The threshold settings form (REVIEW10): one score per event type. */
export const thresholdsInputSchema = z.object({
  goal: thresholdInput,
  shot: thresholdInput,
  touch: thresholdInput,
});

export type ThresholdsInput = z.input<typeof thresholdsInputSchema>;

/**
 * The organisation's settings JSON with autoAccept replaced by these
 * thresholds. Every other key is kept as it was.
 */
export type SettingsJsonValue =
  string | number | boolean | null | SettingsJsonValue[] | { [key: string]: SettingsJsonValue };

export function mergeAutoAccept(
  settings: unknown,
  thresholds: AutoAcceptThresholds,
): { [key: string]: SettingsJsonValue } {
  // The settings column is JSON, so its values are JSON values.
  const base =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as { [key: string]: SettingsJsonValue })
      : {};
  return { ...base, autoAccept: { ...thresholds } };
}

/** "0.75", for the settings screen and the coach's read-only view. */
export function formatThreshold(value: number): string {
  return value.toFixed(2);
}

/** The settings screen's field labels (docs/build/design/C11.md, Surface 6). */
export const THRESHOLD_LABELS: Record<AutoAcceptType, string> = {
  goal: "Goals",
  shot: "Shots",
  touch: "Touches",
};
