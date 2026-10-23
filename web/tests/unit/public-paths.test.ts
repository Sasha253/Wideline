import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/public-paths";

describe("isPublicPath", () => {
  it.each(["/login", "/login/", "/apply", "/invite/abc123", "/api/auth/session"])(
    "%s is public",
    (path) => expect(isPublicPath(path)).toBe(true),
  );

  it.each([
    "/",
    "/applications",
    "/invites",
    "/apiary",
    "/login-history",
    "/squad/j.smith",
    "/settings/members",
    "/lab/matches",
  ])("%s needs a session", (path) => expect(isPublicPath(path)).toBe(false));
});
