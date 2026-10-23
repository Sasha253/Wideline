import { describe, expect, it } from "vitest";
import { expiryLevel, formatDeletionDate, formatTimeLeft } from "@/components/ui/expiry";

const HOUR = 60 * 60 * 1000;
const now = new Date("2025-10-22T10:00:00+02:00");
const at = (ms: number) => new Date(now.getTime() + ms);

describe("expiryLevel", () => {
  it("is none above 72 hours", () => {
    expect(expiryLevel(at(73 * HOUR), now)).toBe("none");
  });
  it("is warning from 72 hours down to 24 hours", () => {
    expect(expiryLevel(at(72 * HOUR), now)).toBe("warning");
    expect(expiryLevel(at(24 * HOUR), now)).toBe("warning");
  });
  it("is danger under 24 hours and once past", () => {
    expect(expiryLevel(at(24 * HOUR - 60_000), now)).toBe("danger");
    expect(expiryLevel(at(-HOUR), now)).toBe("danger");
  });
});

describe("formatTimeLeft", () => {
  it("floors days, singular and plural", () => {
    expect(formatTimeLeft(72 * HOUR)).toBe("3 days");
    expect(formatTimeLeft(47 * HOUR + 59 * 60_000)).toBe("1 day");
    expect(formatTimeLeft(48 * HOUR)).toBe("2 days");
  });
  it("floors hours, singular and plural", () => {
    expect(formatTimeLeft(23 * HOUR + 59 * 60_000)).toBe("23 hours");
    expect(formatTimeLeft(6 * HOUR)).toBe("6 hours");
    expect(formatTimeLeft(HOUR)).toBe("1 hour");
  });
  it("says under 1 hour below an hour", () => {
    expect(formatTimeLeft(59 * 60_000)).toBe("under 1 hour");
  });
});

describe("formatDeletionDate", () => {
  it("formats without the en-ZA comma", () => {
    expect(formatDeletionDate(new Date("2025-10-24T10:00:00+02:00"))).toBe("Friday 24 Oct");
  });
  it("uses South African time", () => {
    // 23:30 UTC on Thursday is already Friday in Johannesburg.
    expect(formatDeletionDate(new Date("2025-10-23T23:30:00Z"))).toBe("Friday 24 Oct");
  });
});
