import { describe, expect, it } from "vitest";
import {
  ACCOUNT_EXISTS,
  normalisePhone,
  NO_AFFILIATIONS_CHOICE,
  AFFILIATIONS_AND_NONE,
  PASSWORD_TOO_SHORT,
  PLAYER_NAME_REQUIRED,
  passwordField,
  registrationSchema,
  SA_ID_INVALID,
  TERMS_REQUIRED,
  TOO_MANY_ROWS,
  UNDER_18,
  PASSPORT_COUNTRY_REQUIRED,
  DOCUMENT_REQUIRED,
} from "@/server/scouts/fields";
import { fieldErrorsByPath } from "@/lib/action-result";

// AUTH09, AUTH10: the registration form's server checks (docs/build/design/C02.md).

function withCheck(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    let d = Number(first12[11 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return `${first12}${(10 - (sum % 10)) % 10}`;
}

const ID = withCheck("800101500908");
const PASSWORD = "correct-horse-battery";

const valid = {
  name: "Sipho Ndlovu",
  email: "Sipho@Example.com",
  phone: "082 123 4567",
  idDocumentType: "sa_id",
  idNumber: ID,
  idCountry: "",
  clubName: ["Hellenic FC", ""],
  playerName: ["", ""],
  playerClub: ["", ""],
  noAffiliations: false,
  acceptTerms: true,
};

const errorsOf = (input: object, newAccount = true) => {
  const r = registrationSchema({ newAccount }).safeParse(input);
  return r.success ? {} : fieldErrorsByPath(r.error.issues);
};

describe("normalisePhone", () => {
  it.each([
    ["082 123 4567", "+27821234567"],
    ["082-123-4567", "+27821234567"],
    ["+27 82 123 4567", "+27821234567"],
    ["0027821234567", "+27821234567"],
    ["+44 7700 900123", "+447700900123"],
    ["(021) 555 1234", "+27215551234"],
  ])("%s becomes %s", (raw, e164) => {
    expect(normalisePhone(raw)).toBe(e164);
  });

  it.each(["hello", "123", "082 123 456", "+27 82 123 45678", "+0 123 456 789", ""])(
    "rejects %j",
    (raw) => {
      expect(normalisePhone(raw)).toBeNull();
    },
  );
});

describe("registrationSchema", () => {
  it("parses a valid signed-out registration", () => {
    const data = registrationSchema({ newAccount: true }).parse(valid);
    expect(data).toMatchObject({
      name: "Sipho Ndlovu",
      email: "sipho@example.com",
      phone: "+27821234567",
      document: { type: "sa_id", country: "ZA", number: ID },
      affiliations: [{ type: "club", name: "Hellenic FC" }],
    });
  });

  it("requires accepting the terms", () => {
    expect(errorsOf({ ...valid, acceptTerms: false }).acceptTerms).toBe(TERMS_REQUIRED);
  });

  it("requires an affiliation or the explicit none choice", () => {
    expect(errorsOf({ ...valid, clubName: [""] }).noAffiliations).toBe(NO_AFFILIATIONS_CHOICE);
    expect(errorsOf({ ...valid, clubName: [""], noAffiliations: true })).toEqual({});
    expect(errorsOf({ ...valid, noAffiliations: true }).noAffiliations).toBe(AFFILIATIONS_AND_NONE);
  });

  it("keys row errors by index, and needs a player name for a player club", () => {
    const errors = errorsOf({
      ...valid,
      playerName: ["Thabo", ""],
      playerClub: ["", "Kaizer Chiefs"],
    });
    expect(errors["playerName.1"]).toBe(PLAYER_NAME_REQUIRED);
    expect(errorsOf({ ...valid, clubName: ["ok", "x".repeat(121)] })["clubName.1"]).toBe(
      "Use 120 characters or fewer.",
    );
  });

  it("refuses more than 30 rows of one type", () => {
    const clubs = Array.from({ length: 31 }, (_, i) => `Club ${i}`);
    expect(errorsOf({ ...valid, clubName: clubs }).affiliations).toBe(TOO_MANY_ROWS);
  });

  it("never takes a password: the account opens through the emailed link", () => {
    const parsed = registrationSchema({ newAccount: true }).parse({ ...valid, password: PASSWORD });
    expect(parsed).not.toHaveProperty("password");
    expect(JSON.stringify(parsed)).not.toContain(PASSWORD);
    expect(errorsOf({ ...valid, name: "", email: "" }, false)).toEqual({});
  });

  it("needs a 12+ character password when the scout sets one later", () => {
    expect(passwordField.safeParse("short").error?.issues[0]?.message).toBe(PASSWORD_TOO_SHORT);
    expect(passwordField.safeParse(PASSWORD).success).toBe(true);
  });

  it("checks the identity document", () => {
    const badCheck = `${ID.slice(0, 12)}${(Number(ID[12]) + 1) % 10}`;
    expect(errorsOf({ ...valid, idNumber: badCheck }).idNumber).toBe(SA_ID_INVALID);
    expect(errorsOf({ ...valid, idNumber: withCheck("150101500908") }).idNumber).toBe(UNDER_18);
    expect(errorsOf({ ...valid, idDocumentType: "" }).idDocumentType).toBe(DOCUMENT_REQUIRED);
    expect(errorsOf({ ...valid, idDocumentType: "passport", idNumber: "A1234567" }).idCountry).toBe(
      PASSPORT_COUNTRY_REQUIRED,
    );
    const passport = registrationSchema({ newAccount: true }).parse({
      ...valid,
      idDocumentType: "passport",
      idNumber: "a123-4567",
      idCountry: "gb",
    });
    expect(passport.document).toEqual({ type: "passport", country: "GB", number: "A1234567" });
  });

  it("reports every step's errors at once", () => {
    const errors = errorsOf({ phone: "", acceptTerms: false });
    expect(Object.keys(errors)).toEqual(
      expect.arrayContaining([
        "name",
        "email",
        "phone",
        "idDocumentType",
        "noAffiliations",
        "acceptTerms",
      ]),
    );
  });

  it("never puts the input in a zod issue", () => {
    const badId = `${ID.slice(0, 12)}${(Number(ID[12]) + 1) % 10}`;
    const r = registrationSchema({ newAccount: true }).safeParse({
      ...valid,
      idNumber: badId,
      phone: "not a phone",
    });
    expect(r.success).toBe(false);
    const dump = JSON.stringify(r.error!.issues) + r.error!.message;
    expect(dump).not.toContain(badId);
    expect(dump).not.toContain("not a phone");
    expect(r.error!.issues.every((i) => !("input" in i))).toBe(true);
  });

  it("exports the account_exists copy", () => {
    expect(ACCOUNT_EXISTS).toMatch(/^An account already uses this email/);
  });
});
