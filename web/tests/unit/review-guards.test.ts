import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REVIEW_ROUTE_PREFIXES,
  REVIEWER_ROUTE_PREFIXES,
  SCOUT_PLAYER_DATA_PREFIXES,
} from "@/server/auth/reviewer";

// C02 acceptance (AUTH09, ADMIN06): an unapproved or suspended scout gets 403 on every
// review route, and reaches no scout page that shows player data. Every page.tsx,
// route.ts and actions.ts whose URL falls under REVIEWER_ROUTE_PREFIXES must use
// requireReviewerPage(), requireReviewer() or withReviewer(), not requireRole or
// requirePageRole alone, so the C10, C11 and C15 routes inherit the check. The test
// walks all of src/app, so a gated URL served from any route group is caught.

const appDir = join(import.meta.dirname, "../../src/app");

const ROUTE_FILE = /^(page\.tsx|route\.ts|actions\.ts)$/;

/** The URL a file under src/app serves: (group) segments and the file name dropped. */
function urlOf(relativeFile: string): string {
  const segments = relativeFile.split(sep).slice(0, -1);
  const kept = segments.filter((s) => !(s.startsWith("(") && s.endsWith(")")));
  return `/${kept.join("/")}`;
}

function isGated(url: string): boolean {
  return REVIEWER_ROUTE_PREFIXES.some((p) => url === p || url.startsWith(`${p}/`));
}

const all = readdirSync(appDir, { recursive: true, encoding: "utf8" })
  .filter((f) => ROUTE_FILE.test(f.split(sep).at(-1)!))
  .map((f) => ({ file: join(appDir, f), url: urlOf(f) }));

const gated = all.filter((f) => isGated(f.url));

describe("urlOf", () => {
  it("drops route groups and the file name", () => {
    expect(urlOf(join("(app)", "review", "page.tsx"))).toBe("/review");
    expect(urlOf(join("(app)", "(x)", "shortlists", "[id]", "page.tsx"))).toBe("/shortlists/[id]");
    expect(urlOf(join("api", "review", "route.ts"))).toBe("/api/review");
    expect(urlOf("page.tsx")).toBe("/");
  });

  it("gates a prefix and its children only", () => {
    expect(isGated("/review")).toBe(true);
    expect(isGated("/review/abc")).toBe(true);
    expect(isGated("/reviewers")).toBe(false);
    expect(isGated("/scout")).toBe(false);
  });
});

describe("reviewer-gated routes", () => {
  it("gates review and scout player-data paths", () => {
    expect([...REVIEWER_ROUTE_PREFIXES]).toEqual([
      ...REVIEW_ROUTE_PREFIXES,
      ...SCOUT_PLAYER_DATA_PREFIXES,
    ]);
    expect(REVIEWER_ROUTE_PREFIXES).toContain("/review");
    expect(REVIEWER_ROUTE_PREFIXES).toContain("/shortlists");
  });

  it("finds the review queue and shortlists pages", () => {
    const urls = gated.map((f) => f.url);
    expect(urls).toContain("/review");
    expect(urls).toContain("/shortlists");
  });

  it.each(gated.map((f) => [f.url, f.file]))("%s (%s) checks review access", (_url, file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toMatch(/\b(requireReviewerPage|requireReviewer|withReviewer)\(/);
    // The scout role alone is not enough: no bare role guard for scouts.
    expect(src).not.toMatch(/\b(requirePageRole|requireRole|withRole)\(\s*SCOUT_ROLES/);
  });
});
