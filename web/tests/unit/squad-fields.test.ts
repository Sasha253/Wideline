import { describe, expect, it } from "vitest";
import { fieldErrorsFrom } from "@/lib/action-result";
import { formatAge, playerName, teamLabel } from "@/lib/labels";
import {
  DOB_FUTURE,
  DOB_NOT_REAL_FORM,
  DOB_REQUIRED,
  DOB_UNREADABLE,
  FIRST_NAME_REQUIRED,
  FOOT_INVALID,
  HEIGHT_INVALID,
  LAST_NAME_REQUIRED,
  parseDateOfBirth,
  parseShirtNumbers,
  placeholderSchema,
  PLAYER_NAME_TOO_LONG,
  playerSchema,
  POSITION_INVALID,
  SEASON_INVALID,
  SQUAD_NUMBER_INVALID,
  SQUAD_NUMBER_NEEDS_TEAM,
  shirtNumbersTaken,
  teamSchema,
  TEAM_NAME_REQUIRED,
  validatePlayerRow,
} from "@/server/squad/fields";

// SQUAD01, SQUAD02, SQUAD04, SQUAD07: the shared row validator used by the
// player form and the CSV import (docs/build/design/C04.md).

const NOW = new Date("2026-10-24T10:00:00+02:00");
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const row = {
  firstName: "Thabo",
  lastName: "Nkosi",
  dateOfBirth: "14/03/2011",
};

const csv = (raw: Record<string, string>) =>
  validatePlayerRow({ ...row, ...raw }, { source: "csv", hasTeam: true, now: NOW });

const messages = (raw: Record<string, string>) =>
  Object.fromEntries(csv(raw).issues.map((i) => [i.field, i.message]));

describe("parseDateOfBirth", () => {
  it("reads YYYY-MM-DD, YYYY/MM/DD and DD/MM/YYYY as the same day", () => {
    for (const v of ["2011-03-14", "2011/03/14", "14/03/2011", "14-03-2011", "14.03.2011"]) {
      expect(parseDateOfBirth(v)).toEqual({ ok: true, date: utc(2011, 3, 14) });
    }
    expect(parseDateOfBirth("5/6/2011")).toEqual({ ok: true, date: utc(2011, 6, 5) });
  });

  it("never reads month first, and refuses dates that do not exist", () => {
    expect(parseDateOfBirth("03/14/2011")).toEqual({ ok: false, reason: "unreadable" });
    expect(parseDateOfBirth("31/02/2012")).toEqual({ ok: false, reason: "not_real" });
    expect(parseDateOfBirth("2011-02-29")).toEqual({ ok: false, reason: "not_real" });
    expect(parseDateOfBirth("00/01/2011")).toEqual({ ok: false, reason: "not_real" });
    expect(parseDateOfBirth("14 March 2011")).toEqual({ ok: false, reason: "unreadable" });
    expect(parseDateOfBirth("2011-3")).toEqual({ ok: false, reason: "unreadable" });
  });
});

describe("validatePlayerRow", () => {
  it("returns the normalised values for a valid row", () => {
    const res = csv({ position: "rw", preferredFoot: "L", heightCm: "165", squadNumber: "07" });
    expect(res.issues).toEqual([]);
    expect(res.value).toEqual({
      firstName: "Thabo",
      lastName: "Nkosi",
      dateOfBirth: utc(2011, 3, 14),
      position: "RW",
      preferredFoot: "left",
      heightCm: 165,
      squadNumber: 7,
    });
  });

  it("requires names and a date of birth", () => {
    expect(messages({ firstName: " ", lastName: "", dateOfBirth: "" })).toEqual({
      firstName: FIRST_NAME_REQUIRED,
      lastName: LAST_NAME_REQUIRED,
      dateOfBirth: DOB_REQUIRED,
    });
    expect(messages({ firstName: "x".repeat(61) })).toEqual({ firstName: PLAYER_NAME_TOO_LONG });
  });

  it("explains bad dates in the CSV, and uses one sentence in the form", () => {
    expect(messages({ dateOfBirth: "03/14/2011" })).toEqual({ dateOfBirth: DOB_UNREADABLE });
    expect(messages({ dateOfBirth: "31/02/2012" })).toEqual({
      dateOfBirth: "31/02/2012 is not a real date.",
    });
    const form = validatePlayerRow(
      { ...row, dateOfBirth: "2012-02-31" },
      { source: "form", hasTeam: true, now: NOW },
    );
    expect(form.issues).toEqual([{ field: "dateOfBirth", message: DOB_NOT_REAL_FORM }]);
  });

  it("refuses a future date and ages outside 4 to 60", () => {
    expect(messages({ dateOfBirth: "2026-10-25" })).toEqual({ dateOfBirth: DOB_FUTURE });
    expect(messages({ dateOfBirth: "2024-01-01" })).toEqual({
      dateOfBirth: "This makes the player 2 years old. Check the year: players are 4 to 60.",
    });
    expect(messages({ dateOfBirth: "1950-01-01" }).dateOfBirth).toContain("76 years old");
    expect(csv({ dateOfBirth: "2026-10-24" }).issues[0]?.message).toContain("0 years old");
  });

  it("accepts foot aliases and refuses anything else", () => {
    for (const [raw, foot] of [
      ["Left", "left"],
      ["r", "right"],
      ["BOTH", "both"],
      ["b", "both"],
    ] as const) {
      expect(csv({ preferredFoot: raw }).value?.preferredFoot).toBe(foot);
    }
    expect(messages({ preferredFoot: "lefty" })).toEqual({ preferredFoot: FOOT_INVALID });
  });

  it("accepts position codes and labels, and refuses others", () => {
    expect(csv({ position: "Centre-back" }).value?.position).toBe("CB");
    expect(messages({ position: "Sweeper" })).toEqual({ position: POSITION_INVALID });
  });

  it("checks height and squad number bounds", () => {
    expect(csv({ heightCm: "100" }).value?.heightCm).toBe(100);
    expect(csv({ heightCm: "230 cm" }).value?.heightCm).toBe(230);
    expect(messages({ heightCm: "99" })).toEqual({ heightCm: HEIGHT_INVALID });
    expect(messages({ heightCm: "231" })).toEqual({ heightCm: HEIGHT_INVALID });
    expect(messages({ heightCm: "1.72" })).toEqual({ heightCm: HEIGHT_INVALID });
    expect(csv({ squadNumber: "1" }).value?.squadNumber).toBe(1);
    expect(csv({ squadNumber: "99" }).value?.squadNumber).toBe(99);
    expect(messages({ squadNumber: "0" })).toEqual({ squadNumber: SQUAD_NUMBER_INVALID });
    expect(messages({ squadNumber: "100" })).toEqual({ squadNumber: SQUAD_NUMBER_INVALID });
    expect(messages({ squadNumber: "7.5" })).toEqual({ squadNumber: SQUAD_NUMBER_INVALID });
  });
});

describe("playerSchema", () => {
  it("refuses a squad number without a team", () => {
    const res = playerSchema.safeParse({ ...row, teamId: "", squadNumber: "7" });
    expect(res.success).toBe(false);
    expect(fieldErrorsFrom(res.error!.issues)).toEqual({ squadNumber: SQUAD_NUMBER_NEEDS_TEAM });
  });

  it("allows no team without a number, and keeps the team id", () => {
    expect(playerSchema.parse({ ...row, teamId: "" }).teamId).toBeNull();
    expect(playerSchema.parse({ ...row, teamId: "t1", squadNumber: "7" })).toMatchObject({
      teamId: "t1",
      squadNumber: 7,
    });
  });
});

describe("teamSchema", () => {
  it("checks the name and season", () => {
    expect(teamSchema.parse({ name: " U15 Boys ", season: "2026/27", ageGroup: "" })).toEqual({
      name: "U15 Boys",
      season: "2026/27",
      ageGroup: null,
      gender: null,
    });
    const res = teamSchema.safeParse({ name: "", season: "2026/28", gender: "x".repeat(21) });
    expect(fieldErrorsFrom(res.error!.issues)).toEqual({
      name: TEAM_NAME_REQUIRED,
      season: SEASON_INVALID,
      gender: "Use 20 characters or fewer.",
    });
    expect(teamSchema.safeParse({ name: "A", season: "26" }).success).toBe(false);
    expect(teamSchema.safeParse({ name: "A", season: "2099/00" }).success).toBe(true);
  });
});

describe("placeholders", () => {
  it("need a shirt number from 1 to 99, an optional position, and nothing else", () => {
    expect(placeholderSchema.parse({ squadNumber: 7 })).toEqual({ squadNumber: 7, position: null });
    expect(placeholderSchema.parse({ squadNumber: 1, position: "gk" }).position).toBe("GK");
    expect(placeholderSchema.safeParse({ squadNumber: 0 }).success).toBe(false);
    expect(placeholderSchema.safeParse({ squadNumber: 7, position: "x" }).success).toBe(false);
    // Unknown keys such as a name are dropped, never stored.
    expect(
      placeholderSchema.parse({ squadNumber: 7, firstName: "Thabo" } as never),
    ).not.toHaveProperty("firstName");
  });

  it("parse shirt number lists with ranges", () => {
    expect(parseShirtNumbers("1-11, 14")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14]);
    expect(parseShirtNumbers("9 7;7")).toEqual([7, 9]);
    expect(parseShirtNumbers("  ")).toBe("empty");
    expect(parseShirtNumbers("0-3")).toBe("invalid");
    expect(parseShirtNumbers("5-2")).toBe("invalid");
    expect(parseShirtNumbers("100")).toBe("invalid");
    expect(parseShirtNumbers("seven")).toBe("invalid");
    expect(shirtNumbersTaken([7])).toBe(
      "Number 7 is already on this team. Remove it from the list and try again.",
    );
    expect(shirtNumbersTaken([7, 9])).toContain("Numbers 7 and 9 are already on this team.");
  });
});

describe("labels", () => {
  it("formatAge counts whole years on the South African date", () => {
    expect(formatAge(utc(2011, 3, 14), NOW)).toBe(15);
    expect(formatAge(utc(2011, 10, 24), NOW)).toBe(15);
    expect(formatAge(utc(2011, 10, 25), NOW)).toBe(14);
    // 23:30 UTC on the 23rd is already the 24th in Johannesburg.
    expect(formatAge(utc(2011, 10, 24), new Date("2026-10-23T23:30:00Z"))).toBe(15);
    expect(formatAge(null, NOW)).toBeNull();
  });

  it("playerName names placeholders by number", () => {
    expect(playerName({ firstName: "Thabo", lastName: "Nkosi" })).toBe("Thabo Nkosi");
    expect(
      playerName({ firstName: null, lastName: null, isPlaceholder: true, squadNumber: 7 }),
    ).toBe("Unnamed #7");
    expect(playerName({ firstName: null, lastName: null, isPlaceholder: true })).toBe(
      "Unnamed player",
    );
    expect(teamLabel({ name: "U15 Boys", season: "2026" })).toBe("U15 Boys (2026)");
  });
});
