import { describe, expect, it } from "vitest";
import { UNLIMITED } from "@/lib/entitlement-keys";
import {
  COUNT_INVALID,
  COUNT_TOO_BIG,
  GB_INVALID,
  GB_TOO_BIG,
  LIMIT_REQUIRED,
  parseLimitForm,
} from "@/server/platform/entitlement-form";

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe("parseLimitForm", () => {
  it("stores a size in GB as whole bytes", () => {
    expect(parseLimitForm("upload_max_bytes", form({ value: "8.5" }))).toEqual({
      ok: true,
      value: 8_500_000_000,
      reason: null,
    });
  });

  it("lets Unlimited win when a value is also sent", () => {
    const res = parseLimitForm("matches_per_month", form({ value: "12", unlimited: "yes" }));
    expect(res).toMatchObject({ ok: true, value: UNLIMITED });
  });

  it("keeps a trimmed reason", () => {
    const res = parseLimitForm("matches_per_month", form({ value: "250", reason: "  Trial  " }));
    expect(res).toEqual({ ok: true, value: 250, reason: "Trial" });
  });

  it.each([
    ["matches_per_month", "", LIMIT_REQUIRED],
    ["matches_per_month", "-5", COUNT_INVALID],
    ["matches_per_month", "2.5", COUNT_INVALID],
    ["matches_per_month", "1000000001", COUNT_TOO_BIG],
    ["upload_max_bytes", "abc", GB_INVALID],
    ["upload_max_bytes", "10001", GB_TOO_BIG],
  ] as const)("%s refuses %j", (key, value, message) => {
    expect(parseLimitForm(key, form({ value }))).toEqual({
      ok: false,
      fieldErrors: { value: message },
    });
  });

  it("refuses a reason over 500 characters", () => {
    const res = parseLimitForm("matches_per_month", form({ value: "1", reason: "x".repeat(501) }));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.fieldErrors.reason).toBeTruthy();
  });
});
