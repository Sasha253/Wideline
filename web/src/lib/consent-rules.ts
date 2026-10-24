import type { ConsentMethod, ConsentRelationship, ConsentState } from "@/generated/prisma/enums";
import { ageOn } from "./squad-fields";

// Consent rules, labels and copy shared by the server, the club pages and the
// guardian screens (CONS01, CONS02, NFR10; docs/build/design/C05.md, "Labels").
// Client-safe: no zod, no server code. The zod schemas are in
// src/server/consent/fields.ts, as for the squad.

/** The age from which a player decides for themselves (CONS02). */
export const ADULT_AGE = 18;

/** The states in which the club records stats: a grant. */
export const GRANTED_STATES = [
  "club_only",
  "scout_visible",
] as const satisfies readonly ConsentState[];

export function isGranted(state: ConsentState): boolean {
  return (GRANTED_STATES as readonly ConsentState[]).includes(state);
}

/**
 * Under 18 on `on`, in Africa/Johannesburg (ageOn). A player with no date of
 * birth counts as a minor, so a guardian decides (C05 plan, "Assumptions").
 */
export function isMinorOn(dob: Date | null | undefined, on: Date = new Date()): boolean {
  if (!dob) return true;
  return ageOn(dob, on) < ADULT_AGE;
}

/**
 * The state a decision gives (NFR10). Club yes and scouts yes: scout_visible;
 * club yes, scouts no: club_only. Club no: withdrawn after a grant, otherwise
 * none (a refusal, which still records who said no). Scouts yes with club no
 * is not a decision anyone can make: scouts only see stats the club records.
 */
export function stateFor(
  { clubStats, scoutVisible }: { clubStats: boolean; scoutVisible: boolean },
  current: ConsentState = "none",
): ConsentState {
  if (scoutVisible && !clubStats) throw new Error("Scouts yes needs club yes");
  if (clubStats) return scoutVisible ? "scout_visible" : "club_only";
  return isGranted(current) ? "withdrawn" : "none";
}

/** The ConsentBadge words (docs/design-system/components/ConsentBadge). */
export const CONSENT_STATE_LABELS: Record<ConsentState, string> = {
  none: "No consent",
  requested: "Requested",
  club_only: "Club only",
  scout_visible: "Scout-visible",
  withdrawn: "Withdrawn",
};

export const CONSENT_METHOD_LABELS: Record<ConsentMethod, string> = {
  paper_form: "Signed paper form",
  in_person: "In person",
  email: "By email",
  guardian_link: "Guardian link",
};

/** The methods the club form offers. guardian_link is set only by the guardian screens. */
export const CLUB_CONSENT_METHODS = [
  "paper_form",
  "in_person",
  "email",
] as const satisfies readonly ConsentMethod[];

export const RELATIONSHIP_LABELS: Record<ConsentRelationship, string> = {
  parent: "Parent",
  legal_guardian: "Legal guardian",
  grandparent: "Grandparent",
  other_relative: "Other relative",
  self: "The player",
};

/** The relationships a form for a minor offers. self is never a choice: it is set for 18 or over. */
export const GUARDIAN_RELATIONSHIPS = [
  "parent",
  "legal_guardian",
  "grandparent",
  "other_relative",
] as const satisfies readonly ConsentRelationship[];

export const yesNo = (v: boolean) => (v ? "Yes" : "No");

/** Name fields on consent forms (guardian name, who asked). */
export const CONSENT_NAME_MAX = 120;

/** A guardian link decides for 14 days (C05 plan). A product rule, not a plan limit. */
export const CONSENT_LINK_DAYS = 14;

// The state sentence next to the badge on the player page (C05 design,
// "Labels"). {first} is the first name, {club} the organisation, {decider}
// "{grantedBy} ({relationship})" or {first} for self, {date} formatDate().
export const CONSENT_STATE_SENTENCES = {
  none: "No consent recorded yet. Wideline keeps no stats for {first}.",
  none_refused: "{decider} said no on {date}. Wideline keeps no stats for {first}.",
  requested:
    "Waiting for a guardian to answer. Wideline keeps no stats for {first} until they say yes.",
  club_only: "{club} can see {first}'s stats. Scouts cannot.",
  scout_visible: "{club} can see {first}'s stats, and so can scouts.",
  withdrawn:
    "Consent was withdrawn on {date}. Wideline keeps no new stats for {first}, and scouts cannot see them.",
} as const satisfies Record<ConsentState | "none_refused", string>;

/** Fills {first}, {club}, {decider} and {date} in a sentence. */
export function fillConsentCopy(
  template: string,
  values: { first?: string; club?: string; decider?: string; date?: string },
): string {
  return template.replace(/\{(first|club|decider|date)\}/g, (m, key: keyof typeof values) =>
    values[key] !== undefined ? values[key]! : m,
  );
}

/** "Thandi Mokoena (Parent)", or the player's first name when they decided themselves. */
export function deciderText(
  row: { grantedBy: string | null; relationship: ConsentRelationship | null },
  first: string,
): string | null {
  if (row.relationship === "self") return first;
  if (!row.grantedBy) return null;
  return row.relationship
    ? `${row.grantedBy} (${RELATIONSHIP_LABELS[row.relationship]})`
    : row.grantedBy;
}

// Club form and dialog copy (C05 design, Surfaces 2 and 4).
export const GUARDIAN_NAME_REQUIRED = "Enter the full name of the parent or guardian.";
export const CONSENT_NAME_TOO_LONG = "Use 120 characters or fewer.";
export const relationshipRequired = (first: string) => `Choose how they are related to ${first}.`;
export const METHOD_REQUIRED = "Choose how they gave their answer.";
export const DECISION_DATE_REQUIRED = "Enter the date of the decision.";
export const DECISION_DATE_FUTURE = "The date cannot be in the future.";
export const decisionBeforeBirth = (first: string) =>
  `The date cannot be before ${first} was born.`;
export const minorOnDecisionDate = (first: string) =>
  `${first} was under 18 on this date, so a parent or guardian must decide. Change the date, or ask a guardian.`;
export const CLUB_ANSWER_REQUIRED = "Choose yes or no for club stats.";
export const SCOUT_ANSWER_REQUIRED = "Choose yes or no for scouts.";
export const SCOUTS_NEED_CLUB =
  "Scouts can only see stats the club records. Choose No for scouts, or Yes for club stats.";
export const SEEN_WORDING_REQUIRED = "Confirm that they saw this wording.";
export const consentDeparted = (first: string) =>
  `${first} has left the club, so you cannot record new consent. You can still withdraw it on ${first}'s page.`;
export const CONSENT_PLAYER_GONE = "This player no longer exists.";
export const CONSENT_NOT_SAVED = "Consent was not saved. Try again.";
export const DOB_CHANGED_WHILE_RECORDING =
  "The date of birth changed while you were recording this. Check it, then record the answer again.";
/**
 * After a date of birth edit shows the player was under 18 when they gave
 * consent themselves (CONS02): the grant is withdrawn and a guardian decides.
 */
export const selfConsentWithdrawnByDob = (first: string) =>
  `Changes saved. With this date of birth, ${first} was under 18 when they gave consent themselves, so their consent is now withdrawn. Ask a parent or guardian to decide.`;
export const REQUESTED_BY_REQUIRED = "Enter the name of the person who asked.";
export const WITHDRAW_METHOD_REQUIRED = "Choose how they asked.";
export const ALREADY_WITHDRAWN = "Consent is already withdrawn.";
export const CONSENT_NOT_WITHDRAWN = "Consent was not withdrawn. Try again.";
export const LINK_NOT_CREATED = "The link was not created. Try again.";
export const playerIsAdult = (first: string) =>
  `${first} is 18 or over and decides for themselves. Record their answer instead.`;
