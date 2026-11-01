import { describe, expect, it } from "vitest";
import {
  AUTO_ACCEPT_DEFAULTS,
  autoAcceptThresholds,
  eventStatusFor,
  mergeAutoAccept,
  THRESHOLD_ERROR,
  thresholdsInputSchema,
} from "@/lib/auto-accept";

// C08 (REVIEW10, PRD stats catalogue): a CV event at or above its type's
// auto-accept threshold is auto_accepted, below it pending_review. The
// defaults are the catalogue's; an organisation may set its own per type.

describe("autoAcceptThresholds", () => {
  it("uses the stats catalogue's defaults", () => {
    expect(AUTO_ACCEPT_DEFAULTS).toEqual({ goal: 0.9, shot: 0.75, touch: 0.8 });
    expect(autoAcceptThresholds({})).toEqual(AUTO_ACCEPT_DEFAULTS);
    expect(autoAcceptThresholds(null)).toEqual(AUTO_ACCEPT_DEFAULTS);
  });

  it("applies an organisation's own threshold per type", () => {
    expect(autoAcceptThresholds({ autoAccept: { shot: 0.95 } })).toEqual({
      goal: 0.9,
      shot: 0.95,
      touch: 0.8,
    });
  });

  it("falls back per type when a setting is invalid", () => {
    expect(autoAcceptThresholds({ autoAccept: { goal: 1.5, shot: "high", touch: 0.6 } })).toEqual({
      goal: 0.9,
      shot: 0.75,
      touch: 0.6,
    });
    expect(autoAcceptThresholds({ autoAccept: "everything" })).toEqual(AUTO_ACCEPT_DEFAULTS);
    expect(autoAcceptThresholds("not an object")).toEqual(AUTO_ACCEPT_DEFAULTS);
  });
});

describe("eventStatusFor", () => {
  const t = AUTO_ACCEPT_DEFAULTS;

  it("accepts at the threshold and sends anything below to review", () => {
    expect(eventStatusFor("goal", 0.9, t)).toBe("auto_accepted");
    expect(eventStatusFor("goal", 0.8999, t)).toBe("pending_review");
    expect(eventStatusFor("shot", 0.75, t)).toBe("auto_accepted");
    expect(eventStatusFor("shot", 0.74, t)).toBe("pending_review");
    expect(eventStatusFor("touch", 0.8, t)).toBe("auto_accepted");
  });

  it("follows a raised threshold", () => {
    expect(eventStatusFor("shot", 0.8, { ...t, shot: 0.85 })).toBe("pending_review");
  });
});

// C11 (REVIEW10, Q-072): the settings form takes scores from 0.00 to 1.00 with
// at most 2 decimals, stored as typed; saving keeps every other settings key.
describe("thresholdsInputSchema", () => {
  it("takes scores as typed, with no conversion", () => {
    expect(thresholdsInputSchema.parse({ goal: "0.95", shot: ".5", touch: "1" })).toEqual({
      goal: 0.95,
      shot: 0.5,
      touch: 1,
    });
    expect(thresholdsInputSchema.parse({ goal: " 0 ", shot: "0.7", touch: "1.00" })).toEqual({
      goal: 0,
      shot: 0.7,
      touch: 1,
    });
  });

  it.each(["1.01", "-0.1", "75", "0.755", "", "high", "0,75"])("refuses %j", (value) => {
    const r = thresholdsInputSchema.safeParse({ goal: value, shot: "0.75", touch: "0.8" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe(THRESHOLD_ERROR);
  });

  it("round-trips through autoAcceptThresholds", () => {
    const t = thresholdsInputSchema.parse({ goal: "0.85", shot: "0.6", touch: "0.7" });
    expect(autoAcceptThresholds(mergeAutoAccept({}, t))).toEqual(t);
  });
});

describe("mergeAutoAccept", () => {
  it("replaces autoAccept and keeps the other keys", () => {
    const settings = { autoAccept: { goal: 0.5 }, other: { keep: true }, flag: 1 };
    expect(mergeAutoAccept(settings, { goal: 0.9, shot: 0.8, touch: 0.7 })).toEqual({
      autoAccept: { goal: 0.9, shot: 0.8, touch: 0.7 },
      other: { keep: true },
      flag: 1,
    });
    expect(mergeAutoAccept(null, AUTO_ACCEPT_DEFAULTS)).toEqual({
      autoAccept: AUTO_ACCEPT_DEFAULTS,
    });
    expect(mergeAutoAccept([1, 2], AUTO_ACCEPT_DEFAULTS)).toEqual({
      autoAccept: AUTO_ACCEPT_DEFAULTS,
    });
  });
});
