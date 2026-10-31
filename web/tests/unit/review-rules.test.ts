import { describe, expect, it } from "vitest";
import {
  CLAIM_DURATION_MS,
  CLIPS_ONLY_WINDOW_MS,
  claimEndsAt,
  clipsExpireAt,
  compareQueue,
  containsWords,
  isClaimLive,
  normaliseName,
  queueSection,
} from "@/lib/review-rules";

// C10 (REVIEW01, REVIEW02, REVIEW13): the pure claim and queue rules, with a
// fixed clock. A claim lasts exactly 48 hours; the queue is soonest expiry
// first; names compare as whole words.

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-10-30T10:00:00+02:00");
const at = (ms: number) => new Date(now.getTime() + ms);

describe("claims", () => {
  it("ends 48 hours after it is claimed", () => {
    expect(CLAIM_DURATION_MS).toBe(48 * HOUR);
    expect(claimEndsAt(now).getTime() - now.getTime()).toBe(48 * HOUR);
  });

  it("is live up to the last millisecond and ended at exactly 48 hours", () => {
    const claim = { status: "active", expiresAt: claimEndsAt(now) };
    expect(isClaimLive(claim, at(48 * HOUR - 1))).toBe(true);
    expect(isClaimLive(claim, at(48 * HOUR))).toBe(false);
    expect(isClaimLive(claim, at(49 * HOUR))).toBe(false);
  });

  it("is never live once it is not active", () => {
    for (const status of ["released", "expired", "submitted"]) {
      expect(isClaimLive({ status, expiresAt: claimEndsAt(now) }, now)).toBe(false);
    }
  });
});

describe("queueSection", () => {
  it("is waiting while raw footage is stored and not past its expiry", () => {
    expect(queueSection({ rawExpiresAt: at(1), deletedAt: null }, now)).toBe("waiting");
  });

  it("is clips only from the raw expiry until the clips go", () => {
    expect(queueSection({ rawExpiresAt: now, deletedAt: null }, now)).toBe("clips_only");
    expect(queueSection({ rawExpiresAt: at(HOUR), deletedAt: now }, now)).toBe("clips_only");
    const raw = at(-CLIPS_ONLY_WINDOW_MS + 1);
    expect(queueSection({ rawExpiresAt: raw, deletedAt: raw }, now)).toBe("clips_only");
  });

  it("is gone once the clips window has passed, or with no expiry", () => {
    const raw = at(-CLIPS_ONLY_WINDOW_MS);
    expect(queueSection({ rawExpiresAt: raw, deletedAt: raw }, now)).toBe("gone");
    expect(queueSection({ rawExpiresAt: null, deletedAt: null }, now)).toBe("gone");
  });

  it("puts the clips expiry 7 days after the raw expiry", () => {
    expect(clipsExpireAt(now).getTime() - now.getTime()).toBe(7 * 24 * HOUR);
  });
});

describe("compareQueue (REVIEW13)", () => {
  it("orders by raw expiry, then played date, then id", () => {
    const rows = [
      { id: "c", playedAt: at(-2 * HOUR), rawExpiresAt: at(60 * HOUR) },
      { id: "b", playedAt: at(-1 * HOUR), rawExpiresAt: at(20 * HOUR) },
      { id: "a", playedAt: at(-1 * HOUR), rawExpiresAt: at(20 * HOUR) },
      { id: "d", playedAt: at(-3 * HOUR), rawExpiresAt: at(20 * HOUR) },
      { id: "e", playedAt: at(-3 * HOUR), rawExpiresAt: null },
    ];
    expect([...rows].sort(compareQueue).map((r) => r.id)).toEqual(["d", "a", "b", "c", "e"]);
  });
});

describe("names", () => {
  it("normalises accents, case and punctuation", () => {
    expect(normaliseName("  Ajax-Cape Town FC. ")).toBe("ajax cape town fc");
    expect(normaliseName("Zoë  Mthethwa")).toBe("zoe mthethwa");
  });

  it("matches whole words only", () => {
    expect(containsWords("AJAX CAPE TOWN U15 Boys", "Ajax Cape Town")).toBe(true);
    expect(containsWords("Ajaxian FC", "Ajax")).toBe(false);
    expect(containsWords("Hilton College U15", "hilton-college")).toBe(true);
    expect(containsWords("Stellenbosch FC Académie", "academie")).toBe(true);
  });

  it("never matches an empty or one-letter needle", () => {
    expect(containsWords("A Team", "A")).toBe(false);
    expect(containsWords("Anything", "")).toBe(false);
    expect(containsWords("Anything", " . ")).toBe(false);
  });
});
