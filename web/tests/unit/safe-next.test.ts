import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-next";

// The login `next` parameter must never send someone to another site.

describe("safeNextPath", () => {
  it.each(["/settings", "/invite/abc?x=1", "/", "/lab/matches#top"])("accepts %s", (path) => {
    expect(safeNextPath(path, "/fallback")).toBe(path);
  });

  it.each([
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "evil.com",
    "",
    undefined,
    null,
    "/ok\nLocation: https://evil.com",
    "/\tevil",
    "/\u0000x",
  ])("falls back for %j", (path) => {
    expect(safeNextPath(path, "/fallback")).toBe("/fallback");
  });
});
