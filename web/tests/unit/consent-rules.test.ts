import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConsentBadge } from "@/components/ui/ConsentBadge";
import type { ConsentState } from "@/generated/prisma/enums";
import {
  CONSENT_STATE_LABELS,
  CONSENT_STATE_SENTENCES,
  deciderText,
  fillConsentCopy,
  isMinorOn,
  stateFor,
} from "@/lib/consent-rules";
import { formatDateTime } from "@/lib/labels";
import {
  guardianDecisionSchema,
  recordConsentSchema,
  withdrawSchema,
} from "@/server/consent/fields";

// CONS01, CONS02, NFR10: the pure consent rules (docs/build/design/C05.md, "Labels").

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
// 10:00 SAST on a day is 08:00 UTC.
const sast = (iso: string, time = "08:00") => new Date(`${iso}T${time}:00Z`);

describe("isMinorOn (CONS02, Africa/Johannesburg)", () => {
  const dob = utc("2008-10-24");
  it("is a minor the day before the 18th birthday", () => {
    expect(isMinorOn(dob, sast("2026-10-23"))).toBe(true);
  });
  it("is an adult on the 18th birthday", () => {
    expect(isMinorOn(dob, sast("2026-10-24"))).toBe(false);
  });
  it("is an adult after the 18th birthday", () => {
    expect(isMinorOn(dob, sast("2026-10-25"))).toBe(false);
  });
  it("reads the birthday in SAST: 23:30 UTC the evening before is already the birthday", () => {
    expect(isMinorOn(dob, new Date("2026-10-23T23:30:00Z"))).toBe(false);
    expect(isMinorOn(dob, new Date("2026-10-23T21:30:00Z"))).toBe(true);
  });
  it("counts a missing date of birth as a minor", () => {
    expect(isMinorOn(null, sast("2026-10-24"))).toBe(true);
    expect(isMinorOn(undefined)).toBe(true);
  });
});

describe("stateFor (NFR10)", () => {
  it.each([
    [{ clubStats: true, scoutVisible: true }, "none", "scout_visible"],
    [{ clubStats: true, scoutVisible: false }, "none", "club_only"],
    [{ clubStats: true, scoutVisible: true }, "withdrawn", "scout_visible"],
    [{ clubStats: false, scoutVisible: false }, "none", "none"],
    [{ clubStats: false, scoutVisible: false }, "requested", "none"],
    [{ clubStats: false, scoutVisible: false }, "withdrawn", "none"],
    [{ clubStats: false, scoutVisible: false }, "club_only", "withdrawn"],
    [{ clubStats: false, scoutVisible: false }, "scout_visible", "withdrawn"],
  ] as const)("%o from %s is %s", (choices, current, expected) => {
    expect(stateFor(choices, current as ConsentState)).toBe(expected);
  });
  it("refuses scouts yes with club no", () => {
    expect(() => stateFor({ clubStats: false, scoutVisible: true })).toThrow();
  });
});

describe("labels and sentences", () => {
  it("CONSENT_STATE_LABELS match the ConsentBadge words", () => {
    for (const [state, label] of Object.entries(CONSENT_STATE_LABELS)) {
      expect(renderToStaticMarkup(ConsentBadge({ state: state as ConsentState }))).toContain(label);
    }
  });

  it("CONSENT_STATE_SENTENCES cover all five states and a refusal", () => {
    const states: ConsentState[] = ["none", "requested", "club_only", "scout_visible", "withdrawn"];
    for (const s of states) expect(CONSENT_STATE_SENTENCES[s]).toBeTruthy();
    expect(CONSENT_STATE_SENTENCES.none_refused).toContain("{decider}");
    const filled = fillConsentCopy(CONSENT_STATE_SENTENCES.club_only, {
      first: "Lebo",
      club: "Soweto FC",
    });
    expect(filled).toBe("Soweto FC can see Lebo's stats. Scouts cannot.");
  });

  it("deciderText names the guardian and relationship, or the player", () => {
    expect(deciderText({ grantedBy: "Thandi", relationship: "parent" }, "Lebo")).toBe(
      "Thandi (Parent)",
    );
    expect(deciderText({ grantedBy: "Lebo M", relationship: "self" }, "Lebo")).toBe("Lebo");
    expect(deciderText({ grantedBy: null, relationship: null }, "Lebo")).toBeNull();
  });

  it("formatDateTime is 24-hour SAST", () => {
    expect(formatDateTime(new Date("2026-10-24T12:05:00Z"))).toBe("24 Oct 2026, 14:05");
    expect(formatDateTime(new Date("2026-10-24T22:30:00Z"))).toBe("25 Oct 2026, 00:30");
  });
});

describe("zod schemas", () => {
  const now = sast("2026-10-24");
  const valid = {
    grantedBy: "Thandi Mokoena",
    relationship: "parent",
    method: "paper_form",
    grantedAt: "2026-10-24",
    clubStats: "yes",
    scoutVisible: "no",
    seenWording: "on",
  };
  const fieldOf = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
    r.success ? null : r.error!.issues[0]!.path[0];

  it("accepts a complete record", () => {
    const r = recordConsentSchema("Lebo", now).parse(valid);
    expect(r).toMatchObject({ clubStats: true, scoutVisible: false });
    expect(r.grantedAt.toISOString()).toBe("2026-10-24T00:00:00.000Z");
  });

  it("rejects a future decision date", () => {
    const r = recordConsentSchema("Lebo", now).safeParse({ ...valid, grantedAt: "2026-10-25" });
    expect(fieldOf(r)).toBe("grantedAt");
  });

  it("rejects an over-long name", () => {
    const r = recordConsentSchema("Lebo", now).safeParse({ ...valid, grantedBy: "x".repeat(121) });
    expect(fieldOf(r)).toBe("grantedBy");
  });

  it("rejects scouts yes with club no, on the scouts field", () => {
    const r = recordConsentSchema("Lebo", now).safeParse({
      ...valid,
      clubStats: "no",
      scoutVisible: "yes",
    });
    expect(fieldOf(r)).toBe("scoutVisible");
  });

  it("rejects guardian_link from the club form, and a missing confirmation", () => {
    const s = recordConsentSchema("Lebo", now);
    expect(fieldOf(s.safeParse({ ...valid, method: "guardian_link" }))).toBe("method");
    expect(fieldOf(s.safeParse({ ...valid, seenWording: "" }))).toBe("seenWording");
  });

  it("withdrawSchema needs who asked and how", () => {
    const s = withdrawSchema("Lebo");
    expect(fieldOf(s.safeParse({ requestedBy: "", method: "email" }))).toBe("requestedBy");
    expect(fieldOf(s.safeParse({ requestedBy: "Thandi", method: "" }))).toBe("method");
    expect(s.parse({ requestedBy: "Thandi", relationship: "", method: "email" })).toEqual({
      requestedBy: "Thandi",
      relationship: null,
      method: "email",
    });
  });

  it("guardianDecisionSchema refuses self, an over-long name and a missing confirmation", () => {
    const ok = {
      club: "yes",
      scouts: "no",
      guardianName: "Thandi",
      relationship: "parent",
      confirm: "on",
    };
    expect(guardianDecisionSchema.safeParse(ok).success).toBe(true);
    expect(fieldOf(guardianDecisionSchema.safeParse({ ...ok, relationship: "self" }))).toBe(
      "relationship",
    );
    expect(
      fieldOf(guardianDecisionSchema.safeParse({ ...ok, guardianName: "x".repeat(121) })),
    ).toBe("guardianName");
    expect(fieldOf(guardianDecisionSchema.safeParse({ ...ok, confirm: "" }))).toBe("confirm");
  });
});
