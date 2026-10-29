import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// C08 (AUTH06): the CV worker callback is the one route handler with no
// session. It must hand every request to handleCvCallback, which checks the
// instance's HMAC token. Every other API route outside the auth library uses
// a role wrapper. Static checks over src/app/api.

const apiDir = join(import.meta.dirname, "../../src/app/api");
const routes = readdirSync(apiDir, { recursive: true, encoding: "utf8" })
  .filter((f) => f.split(/[\\/]/).at(-1) === "route.ts")
  .map((f) => relative(apiDir, join(apiDir, f)).replaceAll("\\", "/"));

describe("api routes", () => {
  it("has exactly one jobs route, the CV callback", () => {
    expect(routes.filter((r) => r.startsWith("jobs/"))).toEqual(["jobs/[jobId]/callback/route.ts"]);
  });

  it("the callback only exports POST and delegates to handleCvCallback", () => {
    const src = readFileSync(join(apiDir, "jobs/[jobId]/callback/route.ts"), "utf8");
    expect(src).toMatch(/export async function POST\(/);
    expect(src).not.toMatch(/export (async )?function (GET|PUT|PATCH|DELETE)\b/);
    expect(src).toMatch(/handleCvCallback\(/);
    expect(src).not.toMatch(/rawDb|scopedDb/);
  });

  it("every other route with handlers uses a role wrapper", () => {
    const open = routes.filter((r) => {
      if (r.startsWith("jobs/") || r.startsWith("auth/") || r === "health/route.ts") return false;
      const src = readFileSync(join(apiDir, r), "utf8");
      return !/with(Role|Reviewer)\b/.test(src);
    });
    expect(open).toEqual([]);
  });
});
