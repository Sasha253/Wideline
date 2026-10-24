import { describe, expect, it } from "vitest";
import {
  detectDelimiter,
  mapHeader,
  normaliseHeader,
  parseCsv,
  rowValues,
} from "@/server/squad/csv";

// SQUAD03: the CSV reader behind the squad import (docs/build/design/C04.md, Surface 6).

const fields = (text: string) => parseCsv(text).map((r) => r.fields);

describe("parseCsv", () => {
  it("strips a UTF-8 BOM", () => {
    expect(fields("\uFEFFFirst name,Last name\nThabo,Nkosi")).toEqual([
      ["First name", "Last name"],
      ["Thabo", "Nkosi"],
    ]);
  });

  it("reads CRLF and LF line ends, with or without a final line break", () => {
    expect(fields("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(fields("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps commas inside quotes and reads doubled quotes as one", () => {
    expect(fields('name,note\n"Nkosi, Thabo","He said ""hi"""')).toEqual([
      ["name", "note"],
      ["Nkosi, Thabo", 'He said "hi"'],
    ]);
  });

  it("keeps a line break inside quotes and counts lines in the file", () => {
    const records = parseCsv('a,b\n"x\ny",2\n3,4');
    expect(records.map((r) => r.line)).toEqual([1, 2, 4]);
    expect(records[1]!.fields).toEqual(["x\ny", "2"]);
  });

  it("skips blank lines and lines of empty fields, but still counts them", () => {
    const records = parseCsv("a,b\n\n1,2\n,,\n\r\n3,4\n");
    expect(records.map((r) => r.fields)).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(records.map((r) => r.line)).toEqual([1, 3, 6]);
  });

  it("detects semicolons and tabs from the header line", () => {
    expect(detectDelimiter("First name;Last name;DOB\nA;B;C")).toBe(";");
    expect(detectDelimiter("First name\tLast name\nA\tB")).toBe("\t");
    expect(detectDelimiter("First name,Last name")).toBe(",");
    // A comma inside a quoted header does not count.
    expect(detectDelimiter('"Name, full";Surname;DOB')).toBe(";");
    expect(fields("a;b\n1,5;2")).toEqual([
      ["a", "b"],
      ["1,5", "2"],
    ]);
    expect(fields("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("mapHeader", () => {
  it("matches headers case- and punctuation-insensitively, with aliases", () => {
    expect(normaliseHeader(" First_Name ")).toBe("firstname");
    const map = mapHeader([
      "FIRST NAME",
      "surname",
      "DOB",
      "Position",
      "foot",
      "Height_cm",
      "Shirt",
    ]);
    expect(map.missing).toEqual([]);
    expect(map.ignored).toEqual([]);
    expect(map.columns).toEqual({
      firstName: 0,
      lastName: 1,
      dateOfBirth: 2,
      position: 3,
      preferredFoot: 4,
      heightCm: 5,
      squadNumber: 6,
    });
    expect(
      mapHeader(["first-name", "Last name", "Date of birth", "Number"]).columns.squadNumber,
    ).toBe(3);
  });

  it("lists missing required columns by their help names", () => {
    expect(mapHeader(["First name", "Position"]).missing).toEqual(["Last name", "Date of birth"]);
    expect(mapHeader(["First name", "Last name"]).missing).toEqual(["Date of birth"]);
  });

  it("lists unknown columns as ignored, and a repeated column once", () => {
    const map = mapHeader(["First name", "Last name", "DOB", "Email", "Notes", "Surname", ""]);
    expect(map.ignored).toEqual(["Email", "Notes", "Surname"]);
    expect(map.columns.lastName).toBe(1);
  });

  it("reads row values by column, blank for absent columns", () => {
    const map = mapHeader(["DOB", "Last name", "First name"]);
    expect(rowValues([" 2011-03-14 ", "Nkosi", "Thabo"], map.columns)).toEqual({
      firstName: "Thabo",
      lastName: "Nkosi",
      dateOfBirth: "2011-03-14",
      position: "",
      preferredFoot: "",
      heightCm: "",
      squadNumber: "",
    });
  });
});
