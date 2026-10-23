import "server-only";
import { createHmac, hkdfSync } from "node:crypto";
import type { IdDocumentType } from "@/generated/prisma/enums";
import { normaliseIdNumber } from "@/lib/scout-fields";
import { env } from "../env";

/**
 * Scout identity numbers (AUTH09). The ID or passport number is checked,
 * normalised and then kept only as an HMAC-SHA256 with a server secret. A plain
 * sha256 would not do: South African ID numbers have so little entropy (a date
 * of birth, four digits and a check digit) that every one can be hashed in
 * minutes. The raw number never reaches the database, a log line or an action
 * result.
 */

export type IdCheck = "ok" | "invalid" | "under_18";

export { normaliseIdNumber };

/** Luhn check over every digit, the last one being the check digit. */
function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * The date of birth in a South African ID (YYMMDD), or null for an impossible
 * date. A two-digit year later than this year's is taken as the 1900s.
 */
export function saIdDateOfBirth(number: string, now = new Date()): Date | null {
  const yy = Number(number.slice(0, 2));
  const mm = Number(number.slice(2, 4));
  const dd = Number(number.slice(4, 6));
  const thisYY = now.getUTCFullYear() % 100;
  const century = yy > thisYY ? 1900 : 2000;
  const year = century + yy;
  const date = new Date(Date.UTC(year, mm - 1, dd));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) {
    return null;
  }
  return date;
}

function ageOn(dateOfBirth: Date, now: Date): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (now.getUTCMonth() === dateOfBirth.getUTCMonth() &&
      now.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * A normalised South African ID number: 13 digits, a real date of birth, a
 * valid Luhn check digit, and a holder who is 18 or older. "invalid" covers
 * the first three on purpose, so the form never says which check failed.
 */
export function validateSaId(number: string, now = new Date()): IdCheck {
  if (!/^\d{13}$/.test(number)) return "invalid";
  const dob = saIdDateOfBirth(number, now);
  if (!dob || dob.getTime() > now.getTime()) return "invalid";
  if (!luhnValid(number)) return "invalid";
  return ageOn(dob, now) >= 18 ? "ok" : "under_18";
}

/** A normalised passport number: 6 to 20 letters and digits. The country is checked separately. */
export function validatePassport(number: string): IdCheck {
  return /^[A-Z0-9]{6,20}$/.test(number) ? "ok" : "invalid";
}

/** The HMAC key: ID_HASH_SECRET, or outside production a key derived from BETTER_AUTH_SECRET. */
export function idHashSecret(): string {
  const e = env();
  if (e.ID_HASH_SECRET) return e.ID_HASH_SECRET;
  return Buffer.from(
    hkdfSync("sha256", e.BETTER_AUTH_SECRET, "", "wideline:scout-id:v1", 32),
  ).toString("hex");
}

/**
 * The stored check value: hex HMAC-SHA256 of "type:country:number". The type
 * and country are part of the input, so the same digits on two documents are
 * two identities.
 */
export function hashIdNumber(
  { type, country, number }: { type: IdDocumentType; country: string; number: string },
  secret = idHashSecret(),
): string {
  return createHmac("sha256", secret)
    .update(`${type}:${country.toUpperCase()}:${normaliseIdNumber(number)}`)
    .digest("hex");
}
