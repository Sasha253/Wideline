import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// CHUNKS.md "Conventions for every chunk", Consent (CONS03, NFR08, NFR11):
// every player query reads visibility through consentVisibleTo(viewer), and no
// path edits a consent row in place (C05 acceptance). Static checks over src/.

const src = join(import.meta.dirname, "../../src");
const files = readdirSync(src, { recursive: true, encoding: "utf8" })
  .filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("generated/"))
  .map((f) => join(src, f));

const PLAYER_QUERY = /\.player\.(find\w*|count|groupBy|aggregate)\(/;
const CONSENT_EDIT = /\.consent\.(update\w*|upsert|delete\w*)\(/;

describe("player queries", () => {
  const withQueries = files.filter((f) => PLAYER_QUERY.test(readFileSync(f, "utf8")));

  it("finds the squad and consent player queries", () => {
    const rel = withQueries.map((f) => relative(src, f));
    expect(rel).toEqual(
      expect.arrayContaining([
        "server/squad/players.ts",
        "server/squad/teams.ts",
        "server/squad/import.ts",
        "server/consent/records.ts",
        "server/scouts/visible-players.ts",
      ]),
    );
  });

  it.each(withQueries.map((f) => [relative(src, f), f]))(
    "%s reads players through consentVisibleTo",
    (_rel, file) => {
      expect(readFileSync(file, "utf8")).toContain("consentVisibleTo(");
    },
  );
});

describe("consent rows", () => {
  it.each(files.map((f) => [relative(src, f), f]))("%s never edits a consent row", (_rel, file) => {
    expect(readFileSync(file, "utf8")).not.toMatch(CONSENT_EDIT);
  });
});
