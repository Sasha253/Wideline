import { describe, expect, it } from "vitest";
import { FEATURE_KEYS, LIMIT_KEYS } from "@/lib/entitlement-keys";
import { limitText, formatGB, sourceText } from "@/lib/labels";
import { PILOT_PLAN_LIMITS } from "@/server/entitlements/plans";
import { resolveEntitlement, toStoredLimit, withinLimit } from "@/server/entitlements/resolve";

// C03 acceptance (BILL01): resolution order is registry fallback (only when the
// plan lacks the key), plan, override, flag. A flag has the last word.

const none = { overrides: {}, flags: {} };

describe("resolveEntitlement: a limit", () => {
  const key = "matches_per_month" as const;

  it("uses the registry fallback when the plan lacks the key", () => {
    expect(resolveEntitlement(key, { planLimits: {}, ...none })).toEqual({
      value: LIMIT_KEYS[key].fallback,
      source: "default",
      invalid: [],
    });
    expect(resolveEntitlement(key, { planLimits: null, ...none }).source).toBe("default");
  });

  it("plan beats the fallback", () => {
    const r = resolveEntitlement(key, { planLimits: { [key]: 7 }, ...none });
    expect(r).toMatchObject({ value: 7, source: "plan" });
  });

  it("override beats the plan", () => {
    const r = resolveEntitlement(key, {
      planLimits: { [key]: 7 },
      overrides: { [key]: 250 },
      flags: {},
    });
    expect(r).toMatchObject({ value: 250, source: "override" });
  });

  it("flag beats the override: the final word", () => {
    const r = resolveEntitlement(key, {
      planLimits: { [key]: 7 },
      overrides: { [key]: 250 },
      flags: { [key]: 3 },
    });
    expect(r).toMatchObject({ value: 3, source: "flag" });
  });

  it("resolves 'unlimited' to Infinity at any layer", () => {
    expect(resolveEntitlement(key, { planLimits: { [key]: "unlimited" }, ...none }).value).toBe(
      Infinity,
    );
    expect(
      resolveEntitlement(key, {
        planLimits: { [key]: 5 },
        overrides: { [key]: "unlimited" },
        flags: {},
      }).value,
    ).toBe(Infinity);
  });

  it.each([[-1], [1.5], ["100"], [true], [null], [{}], ["Unlimited"]])(
    "skips an invalid value (%j) so the next lower layer wins, and reports it",
    (bad) => {
      const r = resolveEntitlement(key, {
        planLimits: { [key]: 7 },
        overrides: { [key]: bad },
        flags: {},
      });
      expect(r.value).toBe(7);
      expect(r.source).toBe("plan");
      expect(r.invalid).toEqual([{ key, layer: "override", value: bad }]);
    },
  );

  it("falls back to the registry when the plan's value is invalid", () => {
    const r = resolveEntitlement(key, { planLimits: { [key]: "lots" }, ...none });
    expect(r).toMatchObject({ value: LIMIT_KEYS[key].fallback, source: "default" });
    expect(r.invalid).toHaveLength(1);
  });

  it("an invalid flag leaves the override in force", () => {
    const r = resolveEntitlement(key, {
      planLimits: { [key]: 7 },
      overrides: { [key]: 250 },
      flags: { [key]: "x" },
    });
    expect(r).toMatchObject({ value: 250, source: "override" });
  });

  it("ignores unknown keys and non-object plan JSON", () => {
    const r = resolveEntitlement(key, {
      planLimits: { not_a_key: 1, scout_seats: 2 },
      overrides: { other: 9 },
      flags: { other: 9 },
    });
    expect(r).toMatchObject({ value: LIMIT_KEYS[key].fallback, source: "default", invalid: [] });
    for (const planLimits of [[1, 2], "x", 5]) {
      expect(resolveEntitlement(key, { planLimits, ...none }).source).toBe("default");
    }
  });
});

describe("resolveEntitlement: a feature", () => {
  const key = "scout_search" as const;

  it("uses the registry fallback (off) when the plan lacks the key", () => {
    expect(resolveEntitlement(key, { planLimits: {}, ...none })).toMatchObject({
      value: FEATURE_KEYS[key].fallback,
      source: "default",
    });
  });

  it("plan, then override, then flag", () => {
    const plan = { [key]: true };
    expect(resolveEntitlement(key, { planLimits: plan, ...none })).toMatchObject({
      value: true,
      source: "plan",
    });
    expect(
      resolveEntitlement(key, { planLimits: plan, overrides: { [key]: false }, flags: {} }),
    ).toMatchObject({ value: false, source: "override" });
    expect(
      resolveEntitlement(key, {
        planLimits: plan,
        overrides: { [key]: false },
        flags: { [key]: true },
      }),
    ).toMatchObject({ value: true, source: "flag" });
  });

  it("a flag off beats an override on", () => {
    expect(
      resolveEntitlement(key, {
        planLimits: {},
        overrides: { [key]: true },
        flags: { [key]: false },
      }),
    ).toMatchObject({ value: false, source: "flag" });
  });

  it.each([["true"], [1], [0], [null], ["unlimited"]])("skips a non-boolean flag (%j)", (bad) => {
    const r = resolveEntitlement(key, {
      planLimits: { [key]: true },
      overrides: {},
      flags: { [key]: bad },
    });
    expect(r).toMatchObject({ value: true, source: "plan" });
    expect(r.invalid).toEqual([{ key, layer: "flag", value: bad }]);
  });
});

describe("withinLimit (hasCapacity)", () => {
  it("allows used + adding up to the limit, and refuses over it", () => {
    expect(withinLimit(10, 9)).toBe(true);
    expect(withinLimit(10, 10)).toBe(false);
    expect(withinLimit(10, 7, 3)).toBe(true);
    expect(withinLimit(10, 7, 4)).toBe(false);
    expect(withinLimit(0, 0)).toBe(false);
  });

  it("always fits under Infinity", () => {
    expect(withinLimit(Infinity, Number.MAX_SAFE_INTEGER, 1000)).toBe(true);
  });

  it("stores Infinity as 'unlimited'", () => {
    expect(toStoredLimit(Infinity)).toBe("unlimited");
    expect(toStoredLimit(5)).toBe(5);
  });
});

describe("pilot plan and registry", () => {
  it("the pilot plan sets every registry key with a valid value", () => {
    for (const key of [...Object.keys(LIMIT_KEYS), ...Object.keys(FEATURE_KEYS)] as const) {
      const r = resolveEntitlement(key as keyof typeof PILOT_PLAN_LIMITS, {
        planLimits: PILOT_PLAN_LIMITS,
        ...none,
      });
      expect(r.source, key).toBe("plan");
    }
  });

  it("every feature is off on the pilot plan", () => {
    for (const key of Object.keys(FEATURE_KEYS) as (keyof typeof FEATURE_KEYS)[]) {
      expect(PILOT_PLAN_LIMITS[key]).toBe(false);
    }
  });
});

describe("limit labels (docs/build/design/C03.md)", () => {
  it("formats counts with their noun, bytes in decimal GB and Infinity as Unlimited", () => {
    expect(limitText("matches_per_month", 1)).toBe("1 match");
    expect(limitText("matches_per_month", 250)).toBe("250 matches");
    expect(limitText("favourited_clips", 10_000)).toBe("10,000 clips");
    expect(limitText("upload_max_bytes", 8_589_934_592)).toBe("8.59 GB");
    expect(formatGB(10_000_000_000)).toBe("10 GB");
    expect(limitText("scout_seats", Infinity)).toBe("Unlimited");
  });

  it("names the source, with the plan name", () => {
    expect(sourceText("plan", "Pilot")).toBe("From the Pilot plan");
    expect(sourceText("plan", null)).toBe("Built-in default");
    expect(sourceText("flag", "Pilot")).toBe("From a flag");
    expect(sourceText("override", null)).toBe("From an override");
    expect(sourceText("default", "Pilot")).toBe("Built-in default");
  });
});
