import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// CHUNKS.md "Conventions for every chunk", Consent (CONS03, NFR08, NFR11):
// every player query reads visibility through consentVisibleTo(viewer), and no
// path edits a consent row in place (C05 acceptance). Static checks over src/.
//
// Checked per call site, not per file: each player query, each players
// relation filter (players: { where … }, also inside _count) must spread
// consentVisibleTo( inside its own call or object. A bare players: true reads
// the relation with no filter and is refused.

const src = join(import.meta.dirname, "../../src");
const files = readdirSync(src, { recursive: true, encoding: "utf8" })
  .filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("generated/"))
  .map((f) => join(src, f));

const PLAYER_QUERY = /\.player\.(find\w*|count|groupBy|aggregate)\(/g;
const PLAYERS_RELATION = /\bplayers: \{/g;
const PLAYERS_BARE = /\bplayers: true\b/g;
const CONSENT_EDIT = /\.consent\.(update\w*|upsert|delete\w*)\(/;
const SPREAD = "...consentVisibleTo(";

const CLOSE: Record<string, string> = { "(": ")", "{": "}" };

/** The text from the bracket at `open` to its matching close, inclusive. */
function balanced(text: string, open: number): string {
  const opener = text[open]!;
  const closer = CLOSE[opener]!;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === opener) depth++;
    else if (text[i] === closer && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

/** Every player query or players relation read in `text` without a consentVisibleTo spread. */
function unfilteredPlayerReads(text: string): string[] {
  const bad: string[] = [];
  for (const re of [PLAYER_QUERY, PLAYERS_RELATION]) {
    for (const m of text.matchAll(re)) {
      const open = m.index + m[0].length - 1;
      if (!balanced(text, open).includes(SPREAD))
        bad.push(`line ${lineOf(text, m.index)}: ${m[0]}`);
    }
  }
  for (const m of text.matchAll(PLAYERS_BARE)) bad.push(`line ${lineOf(text, m.index)}: ${m[0]}`);
  return bad;
}

const sites = (text: string) =>
  [...text.matchAll(PLAYER_QUERY), ...text.matchAll(PLAYERS_RELATION)].length +
  [...text.matchAll(PLAYERS_BARE)].length;

describe("player queries", () => {
  const withQueries = files.filter((f) => sites(readFileSync(f, "utf8")) > 0);

  it("finds the squad and consent player queries", () => {
    const rel = withQueries.map((f) => relative(src, f));
    expect(rel).toEqual(
      expect.arrayContaining([
        "server/squad/players.ts",
        "server/squad/teams.ts",
        "server/squad/import.ts",
        "server/squad/errors.ts",
        "server/consent/records.ts",
        "server/consent/guardian.ts",
        "server/consent/visibility.ts",
        "server/scouts/visible-players.ts",
        // C06: lineup writes re-read every chosen player.
        "server/matches/lineups.ts",
      ]),
    );
  });

  it.each(withQueries.map((f) => [relative(src, f), f]))(
    "%s spreads consentVisibleTo into every player read",
    (_rel, file) => {
      expect(unfilteredPlayerReads(readFileSync(file, "utf8"))).toEqual([]);
    },
  );

  it("flags each unfiltered call site, even next to a filtered one", () => {
    const text = `
      await db.player.findMany({ where: { id, ...consentVisibleTo({ kind: "club" }) } });
      await db.player.count({ where: { teamId } });
      await db.team.findFirst({
        select: { _count: { select: { players: { where: { clubStatus: "active" } } } } },
      });
      await db.team.findFirst({ select: { _count: { select: { players: true } } } });
      const where = { ...consentVisibleTo({ kind: "club" }) };
      await db.player.groupBy({ by: ["clubStatus"], where });
    `;
    expect(unfilteredPlayerReads(text)).toEqual([
      "line 3: .player.count(",
      "line 9: .player.groupBy(",
      "line 5: players: {",
      "line 7: players: true",
    ]);
  });
});

describe("consent rows", () => {
  it.each(files.map((f) => [relative(src, f), f]))("%s never edits a consent row", (_rel, file) => {
    expect(readFileSync(file, "utf8")).not.toMatch(CONSENT_EDIT);
  });
});
