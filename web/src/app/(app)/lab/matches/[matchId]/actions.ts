"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { BenchmarkTagSource } from "@/generated/prisma/enums";
import type { ActionResult } from "@/lib/action-result";
import { LAB_ROLES, requireRole } from "@/server/auth/session";
import {
  CalibrationInputError,
  saveManualCalibration,
  type CalibrationPointInput,
} from "@/server/cv/calibration";
import { log } from "@/server/log";
import {
  importTags,
  MAX_ROW_ERRORS_SHOWN,
  MAX_TAG_BYTES,
  TAG_SOURCES,
  TagImportError,
} from "@/server/lab/tags";

// Server actions for the Lab's match benchmark and calibration pages
// (docs/build/design/C09.md, Surfaces 3 and 4). Platform admins only.

const IMPORT_FAILED = "We could not import the tags. Try again.";

/** Row errors travel as fieldErrors "row.0", "row.1"… (at most 20), plus "rowsMore". */
function rowErrors(errors: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  errors.slice(0, MAX_ROW_ERRORS_SHOWN).forEach((e, i) => (out[`row.${i}`] = e));
  if (errors.length > MAX_ROW_ERRORS_SHOWN) {
    out.rowsMore = String(errors.length - MAX_ROW_ERRORS_SHOWN);
  }
  return out;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export async function importTagsAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(LAB_ROLES);
  const matchId = String(formData.get("matchId") ?? "");
  const sourceRaw = String(formData.get("source") ?? "hand");
  const source = (TAG_SOURCES as string[]).includes(sourceRaw)
    ? (sourceRaw as BenchmarkTagSource)
    : "hand";
  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;
  const pasted = String(formData.get("csv") ?? "");
  const hasPaste = pasted.trim() !== "";
  if (!hasFile && !hasPaste) {
    return {
      ok: false,
      formError: "Choose a CSV file or paste CSV.",
      fieldErrors: { file: "Choose a CSV file or paste CSV." },
    };
  }
  if (hasFile && hasPaste) {
    return { ok: false, formError: "Choose a file or paste CSV, not both." };
  }
  let csv = pasted;
  if (hasFile) {
    if (file.size > MAX_TAG_BYTES) {
      return { ok: false, formError: "The file is larger than 1 MB." };
    }
    const text = await file.text();
    const textual =
      !text.includes("\u0000") &&
      (/\.csv$/i.test(file.name) || /^text\/|csv/.test(file.type) || file.type === "");
    if (!textual) return { ok: false, formError: "This file is not a CSV file." };
    csv = text;
  } else if (Buffer.byteLength(pasted, "utf8") > MAX_TAG_BYTES) {
    return { ok: false, formError: "The file is larger than 1 MB." };
  }
  try {
    const r = await importTags(ctx, matchId, source, csv);
    revalidatePath(`/lab/matches/${matchId}`);
    revalidatePath("/lab/matches");
    revalidatePath("/lab/benchmark");
    const parts = [
      r.goal ? plural(r.goal, "goal", "goals") : null,
      r.shot ? plural(r.shot, "shot", "shots") : null,
      r.touch ? plural(r.touch, "touch", "touches") : null,
    ].filter(Boolean);
    return {
      ok: true,
      message: `Imported ${plural(r.count, "tag", "tags")}: ${parts.join(", ")}. Recall is updated.`,
      key: String(Date.now()),
    };
  } catch (err) {
    if (err instanceof TagImportError) {
      return { ok: false, formError: err.formError, fieldErrors: rowErrors(err.rowErrors) };
    }
    log.error({ err, matchId }, "tag import failed");
    return { ok: false, formError: IMPORT_FAILED };
  }
}

const CALIBRATION_MESSAGES: Record<string, string> = {
  too_few: "Place at least 4 points.",
  too_many: "Use at most 12 points.",
  degenerate: "These points do not fit a pitch. Spread them out, not along one line.",
  changed:
    "Someone saved a calibration for this venue since you opened this page. Reload to see it.",
  not_found: "We could not save the calibration. Nothing was changed. Try again.",
};

export async function saveCalibrationAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireRole(LAB_ROLES);
  const matchId = String(formData.get("matchId") ?? "");
  const expected = String(formData.get("expectedCurrentId") ?? "");
  let points: CalibrationPointInput[] = [];
  try {
    const raw = JSON.parse(String(formData.get("points") ?? "[]")) as unknown;
    if (Array.isArray(raw)) {
      // An empty field arrives as null or "": NaN, so it is reported, not read as 0.
      const num = (v: unknown) => (v === null || v === "" ? NaN : Number(v));
      points = raw.map((p) => ({
        landmark: String((p as { landmark?: unknown }).landmark ?? ""),
        x: num((p as { x?: unknown }).x),
        y: num((p as { y?: unknown }).y),
      }));
    }
  } catch {
    points = [];
  }
  try {
    await saveManualCalibration(ctx, {
      matchId,
      points,
      expectedCurrentId: expected || null,
    });
  } catch (err) {
    if (err instanceof CalibrationInputError) {
      if (err.code === "fields") {
        return {
          ok: false,
          formError: "Fix the points marked below.",
          fieldErrors: err.fieldErrors,
        };
      }
      if (err.code === "error_too_large") {
        return {
          ok: false,
          formError: `The error is ${err.errorM?.toFixed(1)} m. It must be 1.5 m or less.`,
        };
      }
      return { ok: false, formError: CALIBRATION_MESSAGES[err.code] };
    }
    log.error({ err, matchId }, "calibration save failed");
    return {
      ok: false,
      formError: "We could not save the calibration. Nothing was changed. Try again.",
    };
  }
  revalidatePath(`/lab/matches/${matchId}`, "layout");
  redirect(`/lab/matches/${matchId}?done=calibrated`);
}
