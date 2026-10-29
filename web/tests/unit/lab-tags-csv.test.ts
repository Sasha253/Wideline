import { describe, expect, it } from "vitest";
import { parseTagsCsv, parseTagTime } from "@/server/lab/tags";

// C09 (Q-046): the Lab's tag CSV (docs/build/design/C09.md, Surface 3).

const HEADER = "type,time,teamSide,onTarget";

describe("parseTagTime", () => {
  it("reads video times and ms", () => {
    expect(parseTagTime("47:12.4")).toBe(2_832_400);
    expect(parseTagTime("0:02.0")).toBe(2000);
    expect(parseTagTime("2:05")).toBe(125_000);
    expect(parseTagTime("125000")).toBe(125_000);
    expect(parseTagTime("1:75.0")).toBeNull();
    expect(parseTagTime("soon")).toBeNull();
  });
});

describe("parseTagsCsv", () => {
  it("parses both time formats and blanks", () => {
    const out = parseTagsCsv(
      `${HEADER}\ngoal,12:04.2,home,\nshot,723800,away,true\ntouch,31:38.6,,\n\n`,
      null,
    );
    expect(out).toEqual({
      ok: true,
      rows: [
        { type: "goal", timestampMs: 724_200, teamSide: "home", onTarget: null },
        { type: "shot", timestampMs: 723_800, teamSide: "away", onTarget: true },
        { type: "touch", timestampMs: 1_898_600, teamSide: null, onTarget: null },
      ],
    });
  });

  it("refuses a wrong header and an empty body", () => {
    expect(parseTagsCsv("type,ms\ngoal,1", null)).toMatchObject({
      ok: false,
      formError: "The first row must be the header type,time,teamSide,onTarget.",
    });
    expect(parseTagsCsv(`${HEADER}\n`, null)).toMatchObject({
      ok: false,
      formError: "There are no rows after the header.",
    });
  });

  it("caps an import at 2,000 rows", () => {
    const rows = Array.from({ length: 2001 }, () => "touch,1000,,").join("\n");
    expect(parseTagsCsv(`${HEADER}\n${rows}`, null)).toMatchObject({
      ok: false,
      formError: "The CSV has 2,001 rows. Import at most 2,000 at a time.",
    });
    const fine = Array.from({ length: 2000 }, () => "touch,1000,,").join("\n");
    expect(parseTagsCsv(`${HEADER}\n${fine}`, null).ok).toBe(true);
  });

  it("names every bad row by its spreadsheet row number", () => {
    const out = parseTagsCsv(
      [
        HEADER,
        "pass,1:00.0,,",
        "goal,later,,",
        "shot,1:00.0,left,",
        "shot,1:00.0,,maybe",
        "goal,1:00.0,,true",
        "touch,1:00.0",
        "goal,99:00.0,,",
      ].join("\n"),
      60 * 60_000,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.formError).toBe("7 rows have errors. Fix them and import again.");
    expect(out.rowErrors).toEqual([
      "Row 2: type must be goal, shot or touch.",
      'Row 3: time "later" is not a time like 47:12.4 or a number of ms.',
      "Row 4: teamSide must be home, away or blank.",
      "Row 5: onTarget must be true, false or blank.",
      "Row 6: onTarget is for shots only.",
      "Row 7: has 2 columns. Each row needs 4.",
      "Row 8: time is past the end of the video (60:00.0).",
    ]);
  });
});
