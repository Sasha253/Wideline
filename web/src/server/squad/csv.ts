import type { PlayerRowInput } from "./fields";

// A small RFC 4180 CSV reader for the squad import (SQUAD03), with no
// dependency. It strips a UTF-8 BOM, reads CRLF and LF, quoted fields with
// doubled quotes and line breaks inside quotes, and skips blank lines. The
// delimiter (comma, semicolon or tab) comes from the header line, because Excel
// in South Africa often saves with semicolons.

export type Delimiter = "," | ";" | "\t";

/** The delimiter that splits the header line into the most fields, outside quotes. */
export function detectDelimiter(text: string): Delimiter {
  const counts: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch in counts) counts[ch as Delimiter] += 1;
  }
  const best = (Object.keys(counts) as Delimiter[]).sort((a, b) => counts[b] - counts[a])[0]!;
  return counts[best] > 0 ? best : ",";
}

export type CsvRecord = { line: number; fields: string[] };

/**
 * Splits CSV text into records. Each record carries the file line it starts
 * on (the header is line 1), so errors can name the line in the file. Blank
 * lines, and lines of empty fields, are skipped but still counted.
 */
export function parseCsv(input: string, delimiter?: Delimiter): CsvRecord[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const sep = delimiter ?? detectDelimiter(text);
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let touched = false;

  const endField = () => {
    fields.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    // A line of only delimiters (",,,,", as spreadsheets save empty rows) is blank too.
    const blank = fields.every((f) => f.trim() === "");
    if (!blank) records.push({ line: recordLine, fields });
    fields = [];
    touched = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      touched = true;
    } else if (ch === sep) {
      touched = true;
      endField();
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += ch;
    }
  }
  if (field !== "" || fields.length > 0 || touched) endRecord();
  return records;
}

export type ColumnKey = keyof PlayerRowInput;

/** The columns of the import, in template order, with the names the help table shows. */
export const CSV_COLUMNS: { key: ColumnKey; label: string; required: boolean }[] = [
  { key: "firstName", label: "First name", required: true },
  { key: "lastName", label: "Last name", required: true },
  { key: "dateOfBirth", label: "Date of birth", required: true },
  { key: "position", label: "Position", required: false },
  { key: "preferredFoot", label: "Preferred foot", required: false },
  { key: "heightCm", label: "Height", required: false },
  { key: "squadNumber", label: "Squad number", required: false },
];

// Header names, compared lowercase with spaces, underscores, hyphens and dots dropped.
const ALIASES: Record<string, ColumnKey> = {
  firstname: "firstName",
  lastname: "lastName",
  surname: "lastName",
  dateofbirth: "dateOfBirth",
  dob: "dateOfBirth",
  birthdate: "dateOfBirth",
  position: "position",
  preferredfoot: "preferredFoot",
  foot: "preferredFoot",
  height: "heightCm",
  heightcm: "heightCm",
  squadnumber: "squadNumber",
  number: "squadNumber",
  shirt: "squadNumber",
  shirtnumber: "squadNumber",
  no: "squadNumber",
};

/** "First name", "first_name", "FIRST-NAME" are all "firstname". */
export function normaliseHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[\s_\-.()]+/g, "");
}

export type HeaderMap = {
  /** Field index per column. */
  columns: Partial<Record<ColumnKey, number>>;
  /** Header names we do not use, as written in the file. */
  ignored: string[];
  /** Labels of required columns the file lacks. */
  missing: string[];
};

/** Maps a header row to columns. A repeated column keeps its first place; later ones are ignored. */
export function mapHeader(header: string[]): HeaderMap {
  const columns: Partial<Record<ColumnKey, number>> = {};
  const ignored: string[] = [];
  header.forEach((raw, i) => {
    const key = ALIASES[normaliseHeader(raw)];
    if (key && columns[key] === undefined) columns[key] = i;
    else if (raw.trim()) ignored.push(raw.trim());
  });
  const missing = CSV_COLUMNS.filter((c) => c.required && columns[c.key] === undefined).map(
    (c) => c.label,
  );
  return { columns, ignored, missing };
}

/** The row's values by column; columns the file lacks are blank. */
export function rowValues(fields: string[], columns: HeaderMap["columns"]): PlayerRowInput {
  const out: PlayerRowInput = {};
  for (const { key } of CSV_COLUMNS) {
    const i = columns[key];
    out[key] = i === undefined ? "" : (fields[i] ?? "").trim();
  }
  return out;
}
