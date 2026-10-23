import { z } from "zod";
import { COUNTRY_CODES } from "@/lib/labels";

// Form fields shared by the invite, application and settings forms. The error
// messages are the copy shown to people (docs/build/design/C01.md).

export const EMAIL_ERROR = "Enter an email address, for example name@club.co.za.";
export const ORG_NAME_REQUIRED = "Enter the organisation name.";
export const NAME_TOO_LONG = "Use 120 characters or fewer.";

/** Trimmed and lowercased. */
export const emailField = z
  .string({ error: EMAIL_ERROR })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: EMAIL_ERROR }).max(254, { error: EMAIL_ERROR }));

export const orgNameField = z
  .string({ error: ORG_NAME_REQUIRED })
  .trim()
  .min(1, { error: ORG_NAME_REQUIRED })
  .max(120, { error: NAME_TOO_LONG });

/** ISO 3166-1 alpha-2. */
export const countryField = z
  .string()
  .trim()
  .toUpperCase()
  .refine((c) => COUNTRY_CODES.has(c), { error: "Choose a country." });

export const regionField = z
  .string()
  .trim()
  .max(80, { error: "Use 80 characters or fewer." })
  .optional()
  .transform((v) => (v ? v : null));
