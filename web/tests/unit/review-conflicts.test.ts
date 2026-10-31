import { describe, expect, it } from "vitest";
import {
  conflictReasons,
  type MatchFacts,
  type ScoutDeclarations,
} from "@/server/review/conflicts";

// C10 (REVIEW02, AUTH10, Q-006, A-8): the pure conflict checks. Each source
// gives its own reason code; a removed declaration blocks for 90 days; the
// result carries booleans and codes only, never a name.

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-30T10:00:00+02:00");
const daysAgo = (d: number) => new Date(now.getTime() - d * DAY);

const match: MatchFacts = {
  organisationId: "org-home",
  homeTeamName: "Hilton College U15",
  awayTeamName: "Ajax Cape Town U15 Boys",
  lineup: [
    { firstName: "Lebo", lastName: "Mokoena" },
    { firstName: null, lastName: null },
  ],
};

const scout = (s: Partial<ScoutDeclarations> = {}): ScoutDeclarations => ({
  organisationIds: new Set(),
  declared: [],
  ...s,
});

const club = (name: string, removedAt: Date | null = null) => ({
  type: "club" as const,
  name,
  clubName: null,
  linkedOrganisationName: null,
  removedAt,
});

describe("conflictReasons", () => {
  it("is clear with no declarations", () => {
    expect(conflictReasons(scout(), match, now)).toEqual({ conflicted: false, reasons: [] });
  });

  it("gives organisation for a linked organisation or a membership", () => {
    const r = conflictReasons(scout({ organisationIds: new Set(["org-home"]) }), match, now);
    expect(r).toEqual({ conflicted: true, reasons: ["organisation"] });
  });

  it("gives team_name for a declared club inside either team name", () => {
    const r = conflictReasons(scout({ declared: [club("Ajax Cape Town")] }), match, now);
    expect(r).toEqual({ conflicted: true, reasons: ["team_name"] });
  });

  it("gives team_name for a represented player's club and a linked organisation's name", () => {
    const player = {
      type: "player" as const,
      name: "Someone Else",
      clubName: "Hilton College",
      linkedOrganisationName: null,
      removedAt: null,
    };
    expect(conflictReasons(scout({ declared: [player] }), match, now).reasons).toEqual([
      "team_name",
    ]);
    const linked = { ...club("Different name"), linkedOrganisationName: "Ajax Cape Town" };
    expect(conflictReasons(scout({ declared: [linked] }), match, now).reasons).toEqual([
      "team_name",
    ]);
  });

  it("does not match part of a word", () => {
    expect(conflictReasons(scout({ declared: [club("Ajaxian")] }), match, now).conflicted).toBe(
      false,
    );
  });

  it("gives player for a represented player named in the lineup", () => {
    const player = {
      type: "player" as const,
      name: "lebo  MOKOENA",
      clubName: null,
      linkedOrganisationName: null,
      removedAt: null,
    };
    expect(conflictReasons(scout({ declared: [player] }), match, now)).toEqual({
      conflicted: true,
      reasons: ["player"],
    });
  });

  it("ignores lineup rows without a name (placeholders)", () => {
    const player = {
      type: "player" as const,
      name: " ",
      clubName: null,
      linkedOrganisationName: null,
      removedAt: null,
    };
    expect(conflictReasons(scout({ declared: [player] }), match, now).conflicted).toBe(false);
  });

  it("keeps a removed declaration blocking at 89 days, not at 91 (Q-006)", () => {
    expect(
      conflictReasons(scout({ declared: [club("Hilton College", daysAgo(89))] }), match, now)
        .conflicted,
    ).toBe(true);
    expect(
      conflictReasons(scout({ declared: [club("Hilton College", daysAgo(91))] }), match, now)
        .conflicted,
    ).toBe(false);
  });

  it("lists every reason that applies", () => {
    const r = conflictReasons(
      scout({ organisationIds: new Set(["org-home"]), declared: [club("Hilton College")] }),
      match,
      now,
    );
    expect(r.reasons).toEqual(["organisation", "team_name"]);
  });

  it("returns only the flag and the reason codes, never a name (A-8)", () => {
    const r = conflictReasons(scout({ declared: [club("Ajax Cape Town")] }), match, now);
    expect(Object.keys(r).sort()).toEqual(["conflicted", "reasons"]);
    expect(JSON.stringify(r)).not.toMatch(/ajax|hilton|lebo|mokoena/i);
  });
});
