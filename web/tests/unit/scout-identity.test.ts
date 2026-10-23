import { describe, expect, it } from "vitest";
import {
  hashIdNumber,
  idHashSecret,
  normaliseIdNumber,
  saIdDateOfBirth,
  validatePassport,
  validateSaId,
} from "@/server/scouts/identity";

// AUTH09: ID and passport numbers are checked, normalised, and kept only as a keyed hash.

const NOW = new Date("2026-10-23T10:00:00Z");
const SECRET = "a".repeat(64);

/** Appends the Luhn check digit to 12 digits. */
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

const VALID = withCheck("800101500908");

describe("validateSaId", () => {
  it("accepts a valid adult ID", () => {
    expect(validateSaId(VALID, NOW)).toBe("ok");
  });

  it("rejects a bad check digit", () => {
    const wrong = `${VALID.slice(0, 12)}${(Number(VALID[12]) + 1) % 10}`;
    expect(validateSaId(wrong, NOW)).toBe("invalid");
  });

  it("rejects the wrong length or non-digits", () => {
    expect(validateSaId(VALID.slice(0, 12), NOW)).toBe("invalid");
    expect(validateSaId(`${VALID}1`, NOW)).toBe("invalid");
    expect(validateSaId(`A${VALID.slice(1)}`, NOW)).toBe("invalid");
  });

  it("rejects an impossible or future date of birth", () => {
    expect(validateSaId(withCheck("800231500908"), NOW)).toBe("invalid");
    expect(validateSaId(withCheck("801301500908"), NOW)).toBe("invalid");
    expect(validateSaId(withCheck("261231500908"), NOW)).toBe("invalid");
  });

  it("refuses anyone under 18, and accepts an 18th birthday today", () => {
    expect(validateSaId(withCheck("100101500908"), NOW)).toBe("under_18");
    expect(validateSaId(withCheck("081024500908"), NOW)).toBe("under_18");
    expect(validateSaId(withCheck("081023500908"), NOW)).toBe("ok");
  });

  it("reads two-digit years after this year as the 1900s", () => {
    expect(saIdDateOfBirth("990101", NOW)?.getUTCFullYear()).toBe(1999);
    expect(saIdDateOfBirth("050101", NOW)?.getUTCFullYear()).toBe(2005);
  });
});

describe("validatePassport", () => {
  it.each(["A1234567", "123456", "AB12345678901234567C"])("accepts %s", (n) => {
    expect(validatePassport(n)).toBe("ok");
  });

  it.each(["12345", "A".repeat(21), "AB1234/56", "ab123456"])("rejects %s", (n) => {
    expect(validatePassport(n)).toBe("invalid");
  });
});

describe("normaliseIdNumber", () => {
  it("drops spaces and hyphens and uppercases", () => {
    expect(normaliseIdNumber(" 800101 5009-087 ")).toBe("8001015009087");
    expect(normaliseIdNumber("ab-12 34 56")).toBe("AB123456");
  });
});

describe("hashIdNumber", () => {
  const doc = { type: "sa_id" as const, country: "ZA", number: VALID };

  it("is deterministic hex of 64 characters", () => {
    const h = hashIdNumber(doc, SECRET);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIdNumber(doc, SECRET)).toBe(h);
  });

  it("never contains the raw number", () => {
    expect(hashIdNumber(doc, SECRET)).not.toContain(VALID);
    expect(hashIdNumber(doc, SECRET)).not.toContain(VALID.slice(0, 6));
  });

  it("hashes the normalised number", () => {
    const spaced = `${VALID.slice(0, 6)} ${VALID.slice(6, 10)}-${VALID.slice(10)}`;
    expect(hashIdNumber({ ...doc, number: spaced }, SECRET)).toBe(hashIdNumber(doc, SECRET));
    expect(hashIdNumber({ type: "passport", country: "gb", number: "ab123456" }, SECRET)).toBe(
      hashIdNumber({ type: "passport", country: "GB", number: "AB123456" }, SECRET),
    );
  });

  it("differs by document type and by country", () => {
    const base = hashIdNumber({ type: "passport", country: "ZA", number: "A1234567" }, SECRET);
    expect(hashIdNumber({ type: "passport", country: "GB", number: "A1234567" }, SECRET)).not.toBe(
      base,
    );
    expect(hashIdNumber({ type: "sa_id", country: "ZA", number: VALID }, SECRET)).not.toBe(
      hashIdNumber({ type: "passport", country: "ZA", number: VALID }, SECRET),
    );
  });

  it("differs with a different secret", () => {
    expect(hashIdNumber(doc, SECRET)).not.toBe(hashIdNumber(doc, "b".repeat(64)));
  });

  it("has a default key outside production (derived from BETTER_AUTH_SECRET)", () => {
    const key = idHashSecret();
    expect(key.length).toBeGreaterThanOrEqual(32);
    expect(hashIdNumber(doc)).toBe(hashIdNumber(doc, key));
  });
});
