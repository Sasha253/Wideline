import { z } from "zod";
import type { ConsentMethod, ConsentRelationship } from "@/generated/prisma/enums";
import {
  CLUB_ANSWER_REQUIRED,
  CLUB_CONSENT_METHODS,
  CONSENT_NAME_MAX,
  CONSENT_NAME_TOO_LONG,
  DECISION_DATE_FUTURE,
  DECISION_DATE_REQUIRED,
  GUARDIAN_NAME_REQUIRED,
  GUARDIAN_RELATIONSHIPS,
  METHOD_REQUIRED,
  REQUESTED_BY_REQUIRED,
  relationshipRequired,
  SCOUT_ANSWER_REQUIRED,
  SCOUTS_NEED_CLUB,
  SEEN_WORDING_REQUIRED,
  WITHDRAW_METHOD_REQUIRED,
} from "@/lib/consent-rules";
import { parseDateOfBirth, todayUtc } from "@/lib/squad-fields";

export * from "@/lib/consent-rules";

// Consent form fields (CONS02, NFR09, NFR10). The messages are the copy shown
// to people (docs/build/design/C05.md, Surfaces 1, 2 and 4). The rules that
// need the player (minor or adult on the decision date, date of birth) are in
// records.ts, with the same copy.

const ALL_RELATIONSHIPS = [
  "self",
  ...GUARDIAN_RELATIONSHIPS,
] as const satisfies readonly ConsentRelationship[];

/** "yes" or "no" from a radio group, as a boolean. */
const yesNoField = (required: string) =>
  z.enum(["yes", "no"], { error: required }).transform((v) => v === "yes");

const optionalName = z
  .string()
  .trim()
  .max(CONSENT_NAME_MAX, { error: CONSENT_NAME_TOO_LONG })
  .optional()
  .transform((v) => (v ? v : null));

const requiredGuardianName = z
  .string({ error: GUARDIAN_NAME_REQUIRED })
  .trim()
  .min(1, { error: GUARDIAN_NAME_REQUIRED })
  .max(CONSENT_NAME_MAX, { error: CONSENT_NAME_TOO_LONG });

/** A decision date: YYYY-MM-DD, today or earlier in South Africa, as UTC midnight. */
const decisionDate = (now: Date) =>
  z
    .string({ error: DECISION_DATE_REQUIRED })
    .trim()
    .min(1, { error: DECISION_DATE_REQUIRED })
    .transform((v, c) => {
      const parsed = parseDateOfBirth(v);
      if (!parsed.ok) {
        c.addIssue({ code: "custom", message: DECISION_DATE_REQUIRED });
        return z.NEVER;
      }
      if (parsed.date.getTime() > todayUtc(now).getTime()) {
        c.addIssue({ code: "custom", message: DECISION_DATE_FUTURE });
        return z.NEVER;
      }
      return parsed.date;
    });

/**
 * The club's record of a decision (Surface 2). grantedBy is required when the
 * form asks for a guardian (`guardianForm`: the player is under 18 today, or
 * has no date of birth); an adult's own decision carries no name field.
 * relationship "self" is the adult form's hidden value. records.ts adds the
 * rules on the decision date, with the same copy.
 */
export function recordConsentSchema(
  first: string,
  now = new Date(),
  { guardianForm = false }: { guardianForm?: boolean } = {},
) {
  return z
    .object({
      // A field rule, not a refinement: zod skips object refinements while any
      // field fails, and this error must show with the others.
      grantedBy: guardianForm ? requiredGuardianName : optionalName,
      relationship: z.enum(ALL_RELATIONSHIPS, { error: relationshipRequired(first) }),
      method: z.enum(CLUB_CONSENT_METHODS, { error: METHOD_REQUIRED }),
      grantedAt: decisionDate(now),
      clubStats: yesNoField(CLUB_ANSWER_REQUIRED),
      scoutVisible: yesNoField(SCOUT_ANSWER_REQUIRED),
      seenWording: z.literal("on", { error: SEEN_WORDING_REQUIRED }),
    })
    .superRefine((v, c) => {
      if (v.scoutVisible && !v.clubStats) {
        c.addIssue({ code: "custom", path: ["scoutVisible"], message: SCOUTS_NEED_CLUB });
      }
    });
}

export type RecordConsentInput = {
  grantedBy?: string;
  relationship?: string;
  method?: string;
  grantedAt?: string;
  clubStats?: string;
  scoutVisible?: string;
  seenWording?: string;
};

/** The withdraw dialog (Surface 4): who asked, how, and for a minor optionally their relationship. */
export function withdrawSchema(first: string) {
  return z.object({
    requestedBy: z
      .string({ error: REQUESTED_BY_REQUIRED })
      .trim()
      .min(1, { error: REQUESTED_BY_REQUIRED })
      .max(CONSENT_NAME_MAX, { error: CONSENT_NAME_TOO_LONG }),
    relationship: z
      .union([
        z.enum(GUARDIAN_RELATIONSHIPS, { error: relationshipRequired(first) }),
        z.literal(""),
      ])
      .optional()
      .transform((v) => (v ? v : null)),
    method: z.enum(CLUB_CONSENT_METHODS, { error: WITHDRAW_METHOD_REQUIRED }),
  });
}

export type WithdrawInput = { requestedBy?: string; relationship?: string; method?: string };

/**
 * The guardian's answer through a link (Surface 1, "you"). Issues carry the
 * field as their path; the action maps them to the error codes name,
 * relationship, confirm and answers.
 */
export const guardianDecisionSchema = z
  .object({
    club: z.enum(["yes", "no"]).transform((v) => v === "yes"),
    scouts: z.enum(["yes", "no"]).transform((v) => v === "yes"),
    guardianName: z.string().trim().min(1).max(CONSENT_NAME_MAX),
    relationship: z.enum(GUARDIAN_RELATIONSHIPS),
    confirm: z.literal("on"),
  })
  .superRefine((v, c) => {
    if (v.scouts && !v.club) c.addIssue({ code: "custom", path: ["club"], message: "answers" });
  });

export type GuardianDecisionInput = {
  club?: string;
  scouts?: string;
  guardianName?: string;
  relationship?: string;
  confirm?: string;
};

export type ClubConsentMethod = (typeof CLUB_CONSENT_METHODS)[number] & ConsentMethod;
