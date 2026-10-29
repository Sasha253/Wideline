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
