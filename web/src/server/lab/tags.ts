import { randomUUID } from "node:crypto";
import type { BenchmarkTagSource } from "@/generated/prisma/enums";
import { formatCount, formatVideoTime } from "@/lib/labels";
import type { AuthContext } from "../auth/session";
import { rawDb } from "../db/raw";
import type { LabEventType } from "./recall";

/**
 * Lab ground-truth tags (C09; Q-046), imported as CSV: columns
 * type,time,teamSide,onTarget; time is the video time as 47:12.4 or in ms.
 * Up to 2,000 rows and 1 MB. Nothing is stored when any row fails; an import
 * replaces the match's tags of the same source in one transaction and is
 * audited (counts only). The parser is pure for the unit tests.
 */

export const TAGS_HEADER = "type,time,teamSide,onTarget";
export const MAX_TAG_ROWS = 2000;
export const MAX_TAG_BYTES = 1024 * 1024;
export const MAX_ROW_ERRORS_SHOWN = 20;
export const TAG_SOURCES: readonly BenchmarkTagSource[] = ["hand", "synthetic", "soccernet"];

export type ParsedTag = {
  type: LabEventType;
  timestampMs: number;
  teamSide: "home" | "away" | null;
  onTarget: boolean | null;
};

export type TagParse =
  { ok: true; rows: ParsedTag[] } | { ok: false; formError: string; rowErrors: string[] };

/** "47:12.4", "2:05" or "125000" (ms) to ms; null when it is neither. */
export function parseTagTime(value: string): number | null {
  const v = value.trim();
  if (/^\d{1,9}$/.test(v)) return Number(v);
  const m = /^(\d{1,3}):([0-5]\d)(?:\.(\d))?$/.exec(v);
  if (!m) return null;
  return Number(m[1]) * 60_000 + Number(m[2]) * 1000 + Number(m[3] ?? 0) * 100;
}

export function parseTagsCsv(text: string, durationMs: number | null): TagParse {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  while (lines.length && lines[lines.length - 1]!.trim() === "") lines.pop();
  const header = (lines[0] ?? "").replace(/\s+/g, "");
  if (header.toLowerCase() !== TAGS_HEADER.toLowerCase()) {
    return {
      ok: false,
      formError: `The first row must be the header ${TAGS_HEADER}.`,
      rowErrors: [],
    };
  }
  const body = lines.slice(1);
  if (body.length === 0) {
    return { ok: false, formError: "There are no rows after the header.", rowErrors: [] };
  }
  if (body.length > MAX_TAG_ROWS) {
    return {
      ok: false,
      formError: `The CSV has ${formatCount(body.length)} rows. Import at most 2,000 at a time.`,
      rowErrors: [],
    };
  }
  const rows: ParsedTag[] = [];
  const errors: string[] = [];
  let badRows = 0;
  body.forEach((line, i) => {
    const r = i + 2; // the header is row 1, as in a spreadsheet
    const cols = line.split(",").map((c) => c.trim());
    const before = errors.length;
    if (cols.length !== 4) {
      errors.push(`Row ${r}: has ${cols.length} columns. Each row needs 4.`);
    } else {
      const [type, time, side, onTarget] = cols as [string, string, string, string];
      const lower = type.toLowerCase();
      const okType = lower === "goal" || lower === "shot" || lower === "touch";
      if (!okType) errors.push(`Row ${r}: type must be goal, shot or touch.`);
      const ms = parseTagTime(time);
      if (ms === null) {
        errors.push(
          `Row ${r}: time "${time.slice(0, 20)}" is not a time like 47:12.4 or a number of ms.`,
        );
      } else if (durationMs !== null && ms > durationMs) {
        errors.push(
          `Row ${r}: time is past the end of the video (${formatVideoTime(durationMs, 1)}).`,
        );
      }
      const s = side.toLowerCase();
      if (s !== "" && s !== "home" && s !== "away") {
        errors.push(`Row ${r}: teamSide must be home, away or blank.`);
      }
      const o = onTarget.toLowerCase();
      if (o !== "" && o !== "true" && o !== "false") {
        errors.push(`Row ${r}: onTarget must be true, false or blank.`);
      } else if (o !== "" && okType && lower !== "shot") {
        errors.push(`Row ${r}: onTarget is for shots only.`);
      }
      if (errors.length === before) {
        rows.push({
          type: lower as LabEventType,
          timestampMs: ms!,
          teamSide: s === "" ? null : (s as "home" | "away"),
          onTarget: o === "" ? null : o === "true",
        });
      }
    }
    if (errors.length > before) badRows += 1;
  });
  if (errors.length) {
    return {
      ok: false,
      formError: `${badRows} ${badRows === 1 ? "row has" : "rows have"} errors. Fix them and import again.`,
      rowErrors: errors,
    };
  }
  return { ok: true, rows };
}

export class TagImportError extends Error {
  constructor(
    readonly formError: string,
    readonly rowErrors: string[] = [],
  ) {
    super(formError);
  }
}

export type TagImportResult = { count: number; goal: number; shot: number; touch: number };

/**
 * Replaces the match's tags of this source. Platform admins only (the Lab
 * action checks the role); the match must be in the active organisation.
 */
export async function importTags(
  ctx: AuthContext,
  matchId: string,
  source: BenchmarkTagSource,
  csv: string,
): Promise<TagImportResult> {
  const match = await ctx.db.match.findFirst({ where: { id: matchId }, select: { id: true } });
  if (!match) throw new TagImportError("We could not import the tags. Try again.");
  const video = await ctx.db.video.findFirst({
    where: { matchId, status: "accepted" },
    orderBy: { createdAt: "desc" },
    select: { durationSec: true },
  });
  const durationMs = video?.durationSec ? Math.round(video.durationSec * 1000) : null;
  const parsed = parseTagsCsv(csv, durationMs);
  if (!parsed.ok) throw new TagImportError(parsed.formError, parsed.rowErrors);

  const { organisationId } = ctx;
  const importBatchId = randomUUID();
  await rawDb.$transaction(async (tx) => {
    await tx.benchmarkTag.deleteMany({ where: { organisationId, matchId, source } });
    await tx.benchmarkTag.createMany({
      data: parsed.rows.map((r) => ({
        organisationId,
        matchId,
        type: r.type,
        timestampMs: r.timestampMs,
        teamSide: r.teamSide,
        onTarget: r.onTarget,
        source,
        importBatchId,
        createdByUserId: ctx.user.id,
      })),
    });
    const count = (t: LabEventType) => parsed.rows.filter((r) => r.type === t).length;
    await tx.auditLog.create({
      data: {
        organisationId,
        actorUserId: ctx.user.id,
        action: "benchmark_tags.imported",
        targetType: "Match",
        targetId: matchId,
        metadata: {
          source,
          importBatchId,
          rows: parsed.rows.length,
          goal: count("goal"),
          shot: count("shot"),
          touch: count("touch"),
        },
      },
    });
  });
  const count = (t: LabEventType) => parsed.rows.filter((r) => r.type === t).length;
  return {
    count: parsed.rows.length,
    goal: count("goal"),
    shot: count("shot"),
    touch: count("touch"),
  };
}
