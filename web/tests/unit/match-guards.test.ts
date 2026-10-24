import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// C06 (AUTH06): every route handler under /api/matches is wrapped in withRole,
// and every page under /matches checks the role and the organisation type
// (academies and clubs only) before it renders. Static checks over src/app.

const appDir = join(import.meta.dirname, "../../src/app");

function filesUnder(dir: string, name: RegExp): string[] {
  return readdirSync(join(appDir, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => name.test(f.split("/").at(-1)!))
    .map((f) => join(appDir, dir, f));
}

const routes = filesUnder("api/matches", /^route\.ts$/);
const pages = filesUnder("(app)/matches", /^page\.tsx$/);
const actions = filesUnder("(app)/matches", /^actions\.ts$/);

/** Exported handler names (GET, POST, ...) and their bodies. */
function handlers(src: string): { name: string; body: string }[] {
  const re = /export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=/g;
  const starts = [...src.matchAll(re)];
  return starts.map((m, i) => ({
    name: m[1]!,
    body: src.slice(m.index, starts[i + 1]?.index ?? src.length),
  }));
}

describe("match route handlers", () => {
  it("finds the upload, parts, complete and video-url routes", () => {
    expect(routes.map((f) => relative(appDir, f)).sort()).toEqual([
      "api/matches/[matchId]/upload/complete/route.ts",
      "api/matches/[matchId]/upload/parts/route.ts",
      "api/matches/[matchId]/upload/route.ts",
      "api/matches/[matchId]/video-url/route.ts",
    ]);
  });

  it.each(routes.map((f) => [relative(appDir, f), f]))(
    "%s wraps every handler in withRole(MATCH_ROLES) and checks the organisation type",
    (_rel, file) => {
      const src = readFileSync(file, "utf8");
      const found = handlers(src);
      expect(found.length).toBeGreaterThan(0);
      expect(src).not.toMatch(/export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/);
      for (const { name, body } of found) {
        expect(body, `${name} must use withRole`).toMatch(/=\s*withRole<[^>]*>\(MATCH_ROLES,/);
        expect(body, `${name} must check the organisation type`).toMatch(/requireSquadOrg\(ctx\)/);
      }
    },
  );
});

describe("match pages", () => {
  it("finds the six C06 pages", () => {
    expect(pages.map((f) => relative(appDir, f)).sort()).toEqual([
      "(app)/matches/[matchId]/edit/page.tsx",
      "(app)/matches/[matchId]/lineup/page.tsx",
      "(app)/matches/[matchId]/markers/page.tsx",
      "(app)/matches/[matchId]/page.tsx",
      "(app)/matches/[matchId]/upload/page.tsx",
      "(app)/matches/new/page.tsx",
      "(app)/matches/page.tsx",
    ]);
  });

  it.each(pages.map((f) => [relative(appDir, f), f]))(
    "%s calls requirePageRole(CLUB_ROLES) and requireSquadOrgPage",
    (_rel, file) => {
      const src = readFileSync(file, "utf8");
      const body = src.slice(src.indexOf("export default async function"));
      expect(body).toMatch(/requireSquadOrgPage\(await requirePageRole\(CLUB_ROLES\)\)/);
    },
  );
});

describe("match actions", () => {
  it.each(actions.map((f) => [relative(appDir, f), f]))(
    "%s writes with MATCH_ROLES, and deletes with MATCH_DELETE_ROLES",
    (_rel, file) => {
      const src = readFileSync(file, "utf8");
      const starts = [...src.matchAll(/export\s+async\s+function\s+(\w+)/g)];
      expect(starts.length).toBeGreaterThan(0);
      starts.forEach((m, i) => {
        const body = src.slice(m.index, starts[i + 1]?.index ?? src.length);
        const roles = m[1] === "deleteMatchAction" ? "MATCH_DELETE_ROLES" : "MATCH_ROLES";
        expect(body, `${m[1]} must call requireRole(${roles})`).toContain(
          `requireSquadOrg(await requireRole(${roles}))`,
        );
      });
    },
  );
});
