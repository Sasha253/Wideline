import { z } from "zod";
import { COUNTRY_CODES } from "@/lib/labels";
import {
  AFFILIATIONS_AND_NONE,
  CLUB_NAME_REQUIRED,
  DOCUMENT_REQUIRED,
  ID_OR_PASSPORT_REQUIRED,
  MAX_AFFILIATIONS_PER_TYPE,
  NO_AFFILIATIONS_CHOICE,
  normaliseIdNumber,
  normalisePhone,
  PASSPORT_COUNTRY_REQUIRED,
  PASSPORT_INVALID,
  PASSPORT_REQUIRED,
  PASSWORD_TOO_SHORT,
  PHONE_INVALID,
  PHONE_REQUIRED,
  PLAYER_NAME_REQUIRED,
  SA_ID_INVALID,
  SA_ID_REQUIRED,
  SCOUT_NAME_REQUIRED,
  TERMS_REQUIRED,
  TOO_MANY_ROWS,
  UNDER_18,
} from "@/lib/scout-fields";
import { emailField, NAME_TOO_LONG } from "../organisations/fields";
import { validatePassport, validateSaId } from "./identity";

export * from "@/lib/scout-fields";

// Form fields for scout registration and the scout profile (AUTH09, AUTH10).
// The messages are the copy shown to people (docs/build/design/C02.md). No
// schema here sets reportInput, so a zod issue never carries what was typed:
// above all, never the ID or passport number.

export const scoutNameField = z
  .string({ error: SCOUT_NAME_REQUIRED })
  .trim()
  .min(1, { error: SCOUT_NAME_REQUIRED })
  .max(120, { error: NAME_TOO_LONG });

export const phoneField = z
  .string({ error: PHONE_REQUIRED })
  .trim()
  .min(1, { error: PHONE_REQUIRED })
  .refine((v) => normalisePhone(v) !== null, { error: PHONE_INVALID })
  .transform((v) => normalisePhone(v)!);

export const idDocumentTypeField = z.enum(["sa_id", "passport"], { error: DOCUMENT_REQUIRED });

export const passwordField = z
  .string({ error: PASSWORD_TOO_SHORT })
  .min(12, { error: PASSWORD_TOO_SHORT })
  .max(128, { error: "Use 128 characters or fewer." });

/** One declared name: a club, a player or a player's club. Blank is allowed and ignored. */
const rowField = z.string().trim().max(120, { error: NAME_TOO_LONG });

export type IdDocumentInput = { type: "sa_id" | "passport"; country: string; number: string };

/**
 * Checks the identity document fields and reports issues on idDocumentType,
 * idNumber or idCountry. Returns the normalised document when it is valid.
 */
export function checkIdDocument(
  raw: { idDocumentType?: unknown; idNumber?: unknown; idCountry?: unknown },
  report: (path: string, message: string) => void,
  now = new Date(),
): IdDocumentInput | null {
  const type = idDocumentTypeField.safeParse(raw.idDocumentType);
  const number = normaliseIdNumber(typeof raw.idNumber === "string" ? raw.idNumber : "");
  if (!type.success) {
    report("idDocumentType", DOCUMENT_REQUIRED);
    if (!number) report("idNumber", ID_OR_PASSPORT_REQUIRED);
    return null;
  }
  if (type.data === "sa_id") {
    const check = number ? validateSaId(number, now) : null;
    if (check === "ok") return { type: "sa_id", country: "ZA", number };
    report("idNumber", !check ? SA_ID_REQUIRED : check === "under_18" ? UNDER_18 : SA_ID_INVALID);
    return null;
  }
  const country = typeof raw.idCountry === "string" ? raw.idCountry.trim().toUpperCase() : "";
  let ok = true;
  if (!number) {
    report("idNumber", PASSPORT_REQUIRED);
    ok = false;
  } else if (validatePassport(number) !== "ok") {
    report("idNumber", PASSPORT_INVALID);
    ok = false;
  }
  if (!COUNTRY_CODES.has(country)) {
    report("idCountry", PASSPORT_COUNTRY_REQUIRED);
    ok = false;
  }
  return ok ? { type: "passport", country, number } : null;
}

export type DeclaredAffiliation =
  { type: "club"; name: string } | { type: "player"; name: string; clubName: string | null };

/**
 * The registration form. Signed out (newAccount) it needs name and email;
 * signed in, those come from the account. It never takes a password: the
 * mailbox owner sets one on /scout after confirming the email (setOwnPassword),
 * so nobody can plant a password on an email they do not control. Every check
 * runs on every submit (when: always), so each step shows its errors at once.
 * Field errors are keyed by path: clubName.2, playerName.0.
 */
export function registrationSchema({ newAccount }: { newAccount: boolean }) {
  return z
    .object({
      name: newAccount ? scoutNameField : z.string().optional(),
      email: newAccount ? emailField : z.string().optional(),
      phone: phoneField,
      idDocumentType: z.string().optional(),
      idNumber: z.string().optional(),
      idCountry: z.string().optional(),
      clubName: z.array(rowField).default([]),
      playerName: z.array(rowField).default([]),
      playerClub: z.array(rowField).default([]),
      noAffiliations: z.boolean().default(false),
      acceptTerms: z.boolean({ error: TERMS_REQUIRED }).refine((v) => v, { error: TERMS_REQUIRED }),
      // Honeypot: people never see this field, so anything in it is a bot.
      website: z.string().optional(),
    })
    .superRefine(
      (d, ctx) => {
        const report = (path: string, message: string) =>
          ctx.addIssue({ code: "custom", path: path.split("."), message });
        checkIdDocument(d, report);

        const clubs = (Array.isArray(d.clubName) ? d.clubName : []).map(trim);
        const players = (Array.isArray(d.playerName) ? d.playerName : []).map(trim);
        const playerClubs = (Array.isArray(d.playerClub) ? d.playerClub : []).map(trim);
        playerClubs.forEach((club, i) => {
          if (club && !players[i]) report(`playerName.${i}`, PLAYER_NAME_REQUIRED);
        });
        const clubCount = clubs.filter(Boolean).length;
        const playerCount = players.filter(Boolean).length;
        if (clubCount > MAX_AFFILIATIONS_PER_TYPE || playerCount > MAX_AFFILIATIONS_PER_TYPE) {
          report("affiliations", TOO_MANY_ROWS);
        }
        const declared = clubCount + playerCount + playerClubs.filter(Boolean).length > 0;
        if (d.noAffiliations === true && declared) report("noAffiliations", AFFILIATIONS_AND_NONE);
        if (d.noAffiliations !== true && !declared)
          report("noAffiliations", NO_AFFILIATIONS_CHOICE);
      },
      { when: () => true },
    )
    .transform((d) => ({
      name: d.name,
      email: d.email,
      phone: d.phone,
      document: checkIdDocument(d, () => {})!,
      affiliations: affiliationsFrom(d),
      website: d.website,
    }));
}

const trim = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function affiliationsFrom(d: {
  clubName: string[];
  playerName: string[];
  playerClub: string[];
}): DeclaredAffiliation[] {
  const clubs: DeclaredAffiliation[] = d.clubName
    .filter(Boolean)
    .map((name) => ({ type: "club", name }));
  const players: DeclaredAffiliation[] = d.playerName.flatMap((name, i) =>
    name ? [{ type: "player" as const, name, clubName: d.playerClub[i] || null }] : [],
  );
  return [...clubs, ...players];
}

export type RegistrationInput = z.input<ReturnType<typeof registrationSchema>>;
export type Registration = z.output<ReturnType<typeof registrationSchema>>;

/** Adding one affiliation on /scout. */
export const affiliationSchema = z
  .object({
    type: z.enum(["club", "player"]),
    name: z.string().trim().max(120, { error: NAME_TOO_LONG }),
    clubName: z
      .string()
      .trim()
      .max(120, { error: NAME_TOO_LONG })
      .optional()
      .transform((v) => (v ? v : null)),
  })
  .superRefine((d, ctx) => {
    if (!d.name) {
      ctx.addIssue({
        code: "custom",
        path: ["name"],
        message: d.type === "club" ? CLUB_NAME_REQUIRED : PLAYER_NAME_REQUIRED,
      });
    }
  });

export type AffiliationInput = z.input<typeof affiliationSchema>;
