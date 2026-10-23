// Scout registration and profile copy and checks shared by the server schemas
// (src/server/scouts/fields.ts) and the client step checks on /register
// (docs/build/design/C02.md). Client-safe: no zod, no server code.

export const SCOUT_NAME_REQUIRED = "Enter your name.";
export const PHONE_REQUIRED = "Enter your mobile number.";
export const PHONE_INVALID = "Enter a mobile number, for example 082 123 4567 or +44 7700 900123.";
export const DOCUMENT_REQUIRED = "Choose South African ID or passport.";
export const ID_OR_PASSPORT_REQUIRED = "Enter your ID or passport number.";
export const SA_ID_REQUIRED = "Enter your ID number.";
export const PASSPORT_REQUIRED = "Enter your passport number.";
export const SA_ID_INVALID = "This ID number is not valid. Check the 13 digits.";
export const UNDER_18 = "You need to be 18 or older to review matches.";
export const PASSPORT_INVALID = "Use 6 to 20 letters and numbers, as printed in your passport.";
export const PASSPORT_COUNTRY_REQUIRED = "Choose the country that issued your passport.";
export const IDENTITY_TAKEN =
  "This ID or passport is already registered. If it is yours, sign in to your existing account.";
export const ACCOUNT_EXISTS =
  "An account already uses this email. Sign in, then come back to register.";
export const NO_AFFILIATIONS_CHOICE =
  'Add a club or a player, or tick "I have no clubs or players to declare".';
export const AFFILIATIONS_AND_NONE = "Untick this box, or remove the clubs and players you added.";
export const PLAYER_NAME_REQUIRED = "Enter the player's name.";
export const CLUB_NAME_REQUIRED = "Enter the club name.";
export const TOO_MANY_ROWS = "You can add up to 30 here.";
export const TERMS_REQUIRED =
  "Tick this box to continue. You need to accept the terms to review matches.";
export const PROFILE_TERMS_REQUIRED = "Tick this box to accept the terms.";
export const PASSWORD_TOO_SHORT = "Use at least 12 characters.";

/** After a signed-out registration: the account opens only through the emailed link. */
export const checkEmailMessage = (email: string) =>
  `We sent a link to ${email}. Open it to confirm your email and sign in to your scout profile. The link works for 24 hours.`;

/** Rows per affiliation type, at registration and on the profile. */
export const MAX_AFFILIATIONS_PER_TYPE = 30;

/**
 * E.164, or null. Spaces, hyphens, dots and brackets are dropped; a leading 00
 * becomes +; a leading 0 is a South African number (+27). A South African
 * number has 9 digits after +27; others 8 to 15 digits in all.
 */
export function normalisePhone(raw: string): string | null {
  let v = raw.replace(/[\s\-.()]/g, "");
  if (v.startsWith("00")) v = `+${v.slice(2)}`;
  else if (v.startsWith("0")) v = `+27${v.slice(1)}`;
  if (!/^\+[1-9]\d{7,14}$/.test(v)) return null;
  if (v.startsWith("+27") && v.length !== 12) return null;
  return v;
}

/** Uppercase, without spaces or hyphens. */
export function normaliseIdNumber(raw: string): string {
  return raw.replace(/[\s-]+/g, "").toUpperCase();
}
