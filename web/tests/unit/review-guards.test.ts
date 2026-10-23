import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REVIEW_ROUTE_PREFIXES } from "@/server/auth/reviewer";

// C02 acceptance (AUTH09, ADMIN06): an unapproved or suspended scout gets 403 on every
// review route. Every page.tsx, route.ts and actions.ts under the review paths must use
// requireReviewerPage(), requireReviewer() or withReviewer(), not requireRole or
// requirePageRole alone, so the C10 and C11 routes inherit the check.

const appDir = join(import.meta.dirname, "../../src/app");

/** The app directories that serve each review URL prefix. */
const DIRS: Record<(typeof REVIEW_ROUTE_PREFIXES)[number], string> = {
  "/review": join(appDir, "(app)/review"),
  "/api/review": join(appDir, "api/review"),
};

function filesUnder(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => /(^|\/)(page\.tsx|route\.ts|actions\.ts)$/.test(f))
      .map((f) => join(dir, f));
  } catch {
    return []; // /api/review does not exist yet (C10).
  }
}

const files = REVIEW_ROUTE_PREFIXES.flatMap((p) => filesUnder(DIRS[p]));

describe("review routes", () => {
  it("covers every review prefix", () => {
    expect(Object.keys(DIRS).sort()).toEqual([...REVIEW_ROUTE_PREFIXES].sort());
  });

  it("finds the review queue page", () => {
    expect(files.some((f) => f.endsWith("(app)/review/page.tsx"))).toBe(true);
  });

  it.each(files)("%s checks review access", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toMatch(/\b(requireReviewerPage|requireReviewer|withReviewer)\(/);
    // The scout role alone is not enough: no bare role guard for scouts.
    expect(src).not.toMatch(/\b(requirePageRole|requireRole|withRole)\(\s*SCOUT_ROLES/);
  });
});
