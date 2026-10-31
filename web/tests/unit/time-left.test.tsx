import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClaimTimeLeft, ClipsTimeLeft, FootageTimeLeft } from "@/components/ui/ExpiryBanner";
import { CLAIM_STATES, ClaimStatusChip } from "@/components/ui/StatusChip";
import { ReviewClaimStatus } from "@/generated/prisma/enums";

// C10 (docs/build/design/C10.md, "Chip preset" and "Time-left pieces"): the
// claim chips cover every status, and each time-left piece picks its tone and
// words at the boundaries. None of them is a live region.

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-10-30T10:00:00+02:00");
const at = (h: number) => new Date(now.getTime() + h * HOUR);
const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const text = (s: string) => s.replace(/<[^>]+>/g, "");

function expectStatic(markup: string) {
  expect(markup).not.toMatch(/aria-live|role="(status|alert)"/);
}

describe("ClaimStatusChip", () => {
  it("has a preset for every ReviewClaimStatus", () => {
    expect(Object.keys(CLAIM_STATES).sort()).toEqual(Object.values(ReviewClaimStatus).sort());
  });

  it.each([
    ["active", "wl-chip--warn", "Claimed"],
    ["submitted", "wl-chip--ok", "Reviewed"],
    ["released", "wl-chip--neutral", "Released"],
    ["expired", "wl-chip--neutral", "Expired"],
  ] as const)("%s reads %s %s", (status, tone, label) => {
    const m = html(<ClaimStatusChip status={status} />);
    expect(m).toContain(tone);
    expect(text(m)).toBe(label);
    expect(m).toContain("<svg");
  });
});

describe("FootageTimeLeft", () => {
  it("is muted words above 72 hours", () => {
    const m = html(<FootageTimeLeft expiresAt={at(73)} now={now} />);
    expect(m).toContain("wl-inline-status--muted");
    expect(text(m)).toBe("Footage deleted in 3 days");
    expectStatic(m);
  });

  it("is a warn chip from 72 hours down to 24", () => {
    const m = html(<FootageTimeLeft expiresAt={at(48)} now={now} />);
    expect(m).toContain("wl-chip--warn");
    expect(text(m)).toBe("Footage deleted in 2 days");
    expectStatic(m);
  });

  it("is a danger chip under 24 hours, and Due now once past", () => {
    const m = html(<FootageTimeLeft expiresAt={at(23)} now={now} />);
    expect(m).toContain("wl-chip--danger");
    expect(text(m)).toBe("Footage deleted in 23 hours");
    const past = html(<FootageTimeLeft expiresAt={at(-1)} now={now} />);
    expect(past).toContain("wl-chip--danger");
    expect(text(past)).toBe("Due now");
  });
});

describe("ClaimTimeLeft", () => {
  it.each([
    [48, "muted", "Claim ends in 2 days"],
    [23, "muted", "Claim ends in 23 hours"],
    [12, "muted", "Claim ends in 12 hours"],
    [11, "warn", "Claim ends in 11 hours"],
  ])("at %i h is %s: %s", (h, tone, words) => {
    const m = html(<ClaimTimeLeft expiresAt={at(h)} now={now} />);
    expect(m).toContain(`wl-inline-status--${tone}`);
    expect(text(m)).toBe(words);
    expectStatic(m);
  });

  it("renders nothing once the claim has ended", () => {
    expect(html(<ClaimTimeLeft expiresAt={at(-1)} now={now} />)).toBe("");
    expect(html(<ClaimTimeLeft expiresAt={now} now={now} />)).toBe("");
  });
});

describe("ClipsTimeLeft", () => {
  it.each([
    [73, "muted", "Clips deleted in 3 days"],
    [48, "muted", "Clips deleted in 2 days"],
    [24, "muted", "Clips deleted in 1 day"],
    [23, "danger", "Clips deleted in 23 hours"],
  ])("at %i h is %s: %s", (h, tone, words) => {
    const m = html(<ClipsTimeLeft clipsExpireAt={at(h)} now={now} />);
    expect(m).toContain(`wl-inline-status--${tone}`);
    expect(text(m)).toBe(words);
    expectStatic(m);
  });

  it("renders nothing once the clips are gone", () => {
    expect(html(<ClipsTimeLeft clipsExpireAt={at(-1)} now={now} />)).toBe("");
  });
});
