import { describe, expect, it } from "vitest";
import {
  CONSENT_WORDING_ORDER,
  CONSENT_WORDING_VERSION,
  CONSENT_WORDINGS,
  consentWording,
} from "@/server/consent/wording";

// CONS04, NFR09, NFR12: the stored wording version exists, and it discloses
// independent scout review and processing outside South Africa, to guardians
// and to adult players alike.

describe("consent wording", () => {
  it("has the current version, with every part for both audiences", () => {
    const version = CONSENT_WORDINGS[CONSENT_WORDING_VERSION];
    expect(version).toBeDefined();
    for (const audience of ["guardian", "player"] as const) {
      for (const part of CONSENT_WORDING_ORDER) {
        expect(version![audience][part].heading).toBeTruthy();
        expect(version![audience][part].body).toBeTruthy();
      }
    }
  });

  it.each(["guardian", "player"] as const)(
    "discloses independent scouts and processing outside South Africa (%s)",
    (audience) => {
      const text = consentWording(CONSENT_WORDING_VERSION, audience)!
        .map((p) => `${p.heading} ${p.body}`)
        .join(" ");
      expect(text).toMatch(/independent scouts/i);
      expect(text).toContain("outside South Africa");
      expect(text).toContain("European Union");
      expect(text).toMatch(/even if you say no to scouts/);
    },
  );

  it("speaks to an adult player as 'you', never 'your child'", () => {
    const text = JSON.stringify(CONSENT_WORDINGS[CONSENT_WORDING_VERSION]!.player);
    expect(text).not.toContain("your child");
    expect(text).not.toContain("Your child");
  });

  it("has no placeholders, so a stored version always means the same words", () => {
    expect(JSON.stringify(CONSENT_WORDINGS)).not.toMatch(/\{\w+\}/);
  });

  it("returns null for an unknown version", () => {
    expect(consentWording("no-such-version", "guardian")).toBeNull();
  });
});
