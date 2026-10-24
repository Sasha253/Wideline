import "server-only";
import { createHash } from "node:crypto";
import { teamLabel } from "@/lib/labels";
import type { AuthContext } from "../auth/session";
import { audit } from "../audit";
import { requireSquadOrg } from "./access";
import { mapHeader, parseCsv, rowValues } from "./csv";
import { isSquadNumberViolation, squadNumberTakenMessage } from "./errors";
import {
  CSV_MAX_BYTES,
  CSV_MAX_ROWS,
  joinAnd,
  parseSquadNumber,
  PLAYER_FIELD_LABELS,
  validatePlayerRow,
  type PlayerRowField,
  type PlayerRowInput,
  type PlayerValues,
} from "./fields";
import { ACTIVE_PLAYER } from "./players";
import { asTransactionClient } from "./tx";

/**
 * CSV squad import (SQUAD03): a preview with per-row errors, then a commit.
 * Nothing is stored between the two. The preview returns a digest of the team
 * and the text; the commit gets the text back, checks every row again, and
 * refuses with a fresh preview when the digest or the valid count differs, so
 * it only ever writes what the person saw. No staging table holds minors' data.
 */

export { CSV_MAX_BYTES, CSV_MAX_ROWS };

export type ImportErrorCode =
  "team" | "too_large" | "too_many_rows" | "unreadable" | "empty" | "missing_columns";

/** A whole-file problem: nothing is previewed. */
export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    readonly detail: { rows?: number; missing?: string[] } = {},
  ) {
    super(`Import: ${code}`);
    this.name = "ImportError";
  }
}

export type ImportRowError = { field: PlayerRowField; label: string; message: string };

export type ImportRow = { line: number; values: PlayerRowInput; errors: ImportRowError[] };

export type ImportPreview = {
  team: { id: string; name: string; season: string };
  rows: ImportRow[];
  validCount: number;
  errorCount: number;
  ignoredColumns: string[];
  digest: string;
  /** The text the digest covers (BOM gone, line ends LF). Send this back to commit. */
  csvText: string;
};

/**
 * The BOM is dropped and line ends become LF before anything else, so the
 * text survives a round trip through a form field (browsers send CRLF) with
 * the same digest.
 */
export function normaliseCsvText(text: string): string {
  return (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n?/g, "\n");
}

/** sha256 of the team and the normalised text. */
export function importDigest(teamId: string, csvText: string): string {
  return createHash("sha256")
    .update(`${teamId}\n${normaliseCsvText(csvText)}`)
    .digest("hex");
}

async function importTeam(ctx: AuthContext, teamId: string) {
  const team = teamId
    ? await ctx.db.team.findFirst({
        where: { id: teamId },
        select: { id: true, name: true, season: true, isOpposition: true },
      })
    : null;
  if (!team || team.isOpposition) throw new ImportError("team");
  return { id: team.id, name: team.name, season: team.season };
}

const key = (first: string, last: string, dob: Date) =>
  `${first.trim().toLowerCase()}|${last.trim().toLowerCase()}|${dob.toISOString().slice(0, 10)}`;

/**
 * Checks a CSV for one own team and writes nothing. Each row goes through the
 * player form's validator, then: a squad number used twice in the file, a
 * number an active player on the team already wears, and a player already in
 * the club (same first name, last name and date of birth, active).
 */
async function checkImport(
  ctx: AuthContext,
  teamId: string,
  rawText: string,
  now = new Date(),
): Promise<ImportPreview & { values: (PlayerValues | null)[] }> {
  if (Buffer.byteLength(rawText, "utf8") > CSV_MAX_BYTES) throw new ImportError("too_large");
  const team = await importTeam(ctx, teamId);
  const csvText = normaliseCsvText(rawText);
  // A file that was not UTF-8 decodes with replacement characters; a binary one has NULs.
  if (csvText.includes("\uFFFD") || csvText.includes("\u0000")) {
    throw new ImportError("unreadable");
  }

  const records = parseCsv(csvText);
  const [header, ...data] = records;
  if (!header) throw new ImportError("empty");
  const map = mapHeader(header.fields);
  if (map.missing.length > 0) throw new ImportError("missing_columns", { missing: map.missing });
  if (data.length === 0) throw new ImportError("empty");
  if (data.length > CSV_MAX_ROWS) throw new ImportError("too_many_rows", { rows: data.length });

  const checked = data.map((r) => {
    const values = rowValues(r.fields, map.columns);
    const { value, issues } = validatePlayerRow(values, { source: "csv", hasTeam: true, now });
    return { line: r.line, values, value, issues };
  });

  // Squad numbers used more than once in the file.
  const linesByNumber = new Map<number, number[]>();
  for (const r of checked) {
    const n = parseSquadNumber(r.values.squadNumber ?? "");
    if (typeof n === "number") linesByNumber.set(n, [...(linesByNumber.get(n) ?? []), r.line]);
  }

  const numbers = [...linesByNumber.keys()];
  const dobs = checked.flatMap((r) => (r.value ? [r.value.dateOfBirth] : []));
  const [holders, sameDob] = await Promise.all([
    numbers.length
      ? ctx.db.player.findMany({
          where: { teamId: team.id, ...ACTIVE_PLAYER, squadNumber: { in: numbers } },
          select: { squadNumber: true, firstName: true, lastName: true, isPlaceholder: true },
        })
      : [],
    dobs.length
      ? ctx.db.player.findMany({
          where: { ...ACTIVE_PLAYER, isPlaceholder: false, dateOfBirth: { in: dobs } },
          select: {
            firstName: true,
            lastName: true,
            dateOfBirth: true,
            team: { select: { name: true, season: true } },
          },
        })
      : [],
  ]);
  const holderByNumber = new Map(holders.map((h) => [h.squadNumber!, h]));
  const existing = new Map(
    sameDob
      .filter((p) => p.firstName && p.lastName && p.dateOfBirth)
      .map((p) => [key(p.firstName!, p.lastName!, p.dateOfBirth!), p.team]),
  );

  const rows: (ImportRow & { value: PlayerValues | null })[] = checked.map((r) => {
    const issues = [...r.issues];
    const n = parseSquadNumber(r.values.squadNumber ?? "");
    if (typeof n === "number") {
      const others = (linesByNumber.get(n) ?? []).filter((l) => l !== r.line);
      if (others.length > 0) {
        const where =
          others.length === 1 ? `line ${others[0]}` : `lines ${joinAnd(others.map(String))}`;
        issues.push({
          field: "squadNumber",
          message: `${n} is also on ${where}. Use each number once.`,
        });
      }
      const holder = holderByNumber.get(n);
      if (holder) {
        const name = holder.isPlaceholder
          ? undefined
          : [holder.firstName, holder.lastName].filter(Boolean).join(" ") || undefined;
        issues.push({ field: "squadNumber", message: squadNumberTakenMessage(n, team, name) });
      }
    }
    if (r.value) {
      const k = key(r.value.firstName, r.value.lastName, r.value.dateOfBirth);
      if (existing.has(k)) {
        const t = existing.get(k);
        issues.push({
          field: "player",
          message: `Someone with this name and date of birth is already in ${t ? teamLabel(t) : "your club"}.`,
        });
      }
    }
    return {
      line: r.line,
      values: r.values,
      errors: issues.map((i) => ({ ...i, label: PLAYER_FIELD_LABELS[i.field] })),
      value: issues.length === 0 ? r.value : null,
    };
  });

  const validCount = rows.filter((r) => r.errors.length === 0).length;
  return {
    team,
    rows: rows.map((r) => ({ line: r.line, values: r.values, errors: r.errors })),
    values: rows.map((r) => r.value),
    validCount,
    errorCount: rows.length - validCount,
    ignoredColumns: map.ignored,
    digest: importDigest(team.id, csvText),
    csvText,
  };
}

export type CommitResult =
  | { status: "done"; created: number; skipped: number; team: ImportPreview["team"] }
  | { status: "stale"; preview: ImportPreview };

function publicPreview(p: Awaited<ReturnType<typeof checkImport>>): ImportPreview {
  return {
    team: p.team,
    rows: p.rows,
    validCount: p.validCount,
    errorCount: p.errorCount,
    ignoredColumns: p.ignoredColumns,
    digest: p.digest,
    csvText: p.csvText,
  };
}

/** The preview step: every row checked, nothing written. Throws ImportError for a whole-file problem. */
export async function previewImport(
  ctx: AuthContext,
  teamId: string,
  rawText: string,
  now = new Date(),
): Promise<ImportPreview> {
  requireSquadOrg(ctx);
  return publicPreview(await checkImport(ctx, teamId, rawText, now));
}

/**
 * Re-runs the preview and creates the valid rows in one transaction with the
 * squad.import audit row. Stale (digest or valid count differs, or a squad
 * number was taken meanwhile and the transaction rolled back) commits nothing
 * and returns the fresh preview.
 */
export async function commitImport(
  ctx: AuthContext,
  teamId: string,
  rawText: string,
  digest: string,
  expectedValid: number,
): Promise<CommitResult> {
  requireSquadOrg(ctx);
  const preview = await checkImport(ctx, teamId, rawText);
  if (preview.digest !== digest || preview.validCount !== expectedValid || expectedValid === 0) {
    return { status: "stale", preview: publicPreview(preview) };
  }
  const values = preview.values.filter((v): v is PlayerValues => v !== null);
  const skipped = preview.errorCount;
  try {
    await ctx.db.$transaction(async (tx) => {
      await tx.player.createMany({
        data: values.map((v) => ({
          ...v,
          organisationId: ctx.organisationId,
          teamId: preview.team.id,
        })),
      });
      await audit(
        {
          organisationId: ctx.organisationId,
          actorUserId: ctx.user.id,
          action: "squad.import",
          targetType: "Team",
          targetId: preview.team.id,
          metadata: { teamId: preview.team.id, created: values.length, skipped },
        },
        asTransactionClient(tx),
      );
    });
  } catch (err) {
    if (isSquadNumberViolation(err)) {
      return { status: "stale", preview: await previewImport(ctx, teamId, rawText) };
    }
    throw err;
  }
  return { status: "done", created: values.length, skipped, team: preview.team };
}
