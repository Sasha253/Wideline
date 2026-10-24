"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { teamLabel } from "@/lib/labels";
import { AuthzError, requireRole, SQUAD_ADMIN_ROLES } from "@/server/auth/session";
import { log } from "@/server/log";
import {
  commitImport,
  CSV_MAX_BYTES,
  CSV_MAX_ROWS,
  ImportError,
  previewImport,
} from "@/server/squad/import";
import type { ImportState } from "./state";

// Server actions for /squad/import (SQUAD03; docs/build/design/C04.md, Surface 6).
// Owners and admins only. The preview writes nothing; the commit re-checks every row.

const NO_PERMISSION = "You do not have permission to import players.";
const UNEXPECTED = "Something went wrong. Nothing was imported. Try again.";
const NOT_CSV = "This file is not a CSV. In Excel, use Save as and choose CSV UTF-8.";
const TOO_LARGE =
  "This file is larger than 512 KB. Split it into smaller files and import each one.";
const CSV_TYPES = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "text/plain",
]);

const upload = (result: ActionResult): ImportState => ({ step: "upload", result });

/** Whole-file problems as the copy on the Team and CSV file fields, or a form error. */
function importErrorResult(err: ImportError): ActionResult {
  switch (err.code) {
    case "team":
      return { ok: false, fieldErrors: { teamId: "Choose one of your club's teams." } };
    case "too_large":
      return { ok: false, fieldErrors: { file: TOO_LARGE } };
    case "too_many_rows":
      return {
        ok: false,
        fieldErrors: {
          file: `This file has ${err.detail.rows} rows. Import up to ${CSV_MAX_ROWS} players at a time.`,
        },
      };
    case "unreadable":
      return {
        ok: false,
        fieldErrors: { file: "We could not read this file. Save it as CSV UTF-8 and try again." },
      };
    case "empty":
      return {
        ok: false,
        fieldErrors: {
          file: "This file has no players in it. Add one row per player under the header row.",
        },
      };
    case "missing_columns": {
      const missing = err.detail.missing ?? [];
      return {
        ok: false,
        formError:
          missing.length === 1
            ? `The file has no ${missing[0]} column. Add it, or download the template to see the columns.`
            : `The file is missing these columns: ${missing.join(", ")}. Add them, or download the template to see the columns.`,
      };
    }
  }
}

/** The 403 for a coach or a tampered request becomes a form error, as the design asks. */
function forbidden(err: unknown): true {
  if (err instanceof AuthzError && err.status === 403) return true;
  throw err;
}

export async function previewImportAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const ctx = await requireRole(SQUAD_ADMIN_ROLES).catch(forbidden);
  if (ctx === true) return upload({ ok: false, formError: NO_PERMISSION });
  const teamId = String(formData.get("teamId") ?? "");
  const file = formData.get("file");
  if (!teamId) return upload({ ok: false, fieldErrors: { teamId: "Choose a team." } });
  if (!(file instanceof File) || (file.size === 0 && !file.name)) {
    return upload({ ok: false, fieldErrors: { file: "Choose a CSV file to import." } });
  }
  const csvName = /\.(csv|txt)$/i.test(file.name);
  if (!csvName && !CSV_TYPES.has(file.type)) {
    return upload({ ok: false, fieldErrors: { file: NOT_CSV } });
  }
  if (file.size > CSV_MAX_BYTES) return upload({ ok: false, fieldErrors: { file: TOO_LARGE } });

  try {
    const text = await file.text();
    // A spreadsheet saved as .xlsx is a zip file, whatever its name says.
    if (text.startsWith("PK\u0003\u0004")) {
      return upload({ ok: false, fieldErrors: { file: NOT_CSV } });
    }
    const preview = await previewImport(ctx, teamId, text);
    return { step: "preview", preview, fileName: file.name, stale: false, result: null };
  } catch (err) {
    if (err instanceof ImportError) return upload(importErrorResult(err));
    log.error({ err }, "squad import preview failed");
    return upload({ ok: false, formError: UNEXPECTED });
  }
}

export async function commitImportAction(
  prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const ctx = await requireRole(SQUAD_ADMIN_ROLES).catch(forbidden);
  const back = (result: ActionResult): ImportState =>
    prev?.step === "preview" ? { ...prev, stale: false, result } : upload(result);
  if (ctx === true) return back({ ok: false, formError: NO_PERMISSION });
  const teamId = String(formData.get("teamId") ?? "");
  const csvText = String(formData.get("csvText") ?? "");
  const digest = String(formData.get("digest") ?? "");
  const expectedValid = Number(formData.get("expectedValid") ?? NaN);
  const fileName = String(formData.get("fileName") ?? "");

  try {
    const res = await commitImport(ctx, teamId, csvText, digest, expectedValid);
    if (res.status === "stale") {
      return { step: "preview", preview: res.preview, fileName, stale: true, result: null };
    }
    revalidatePath("/squad", "layout");
    return {
      step: "done",
      created: res.created,
      skipped: res.skipped,
      team: { id: res.team.id, label: teamLabel(res.team) },
    };
  } catch (err) {
    if (err instanceof ImportError) return upload(importErrorResult(err));
    log.error({ err }, "squad import commit failed");
    return back({ ok: false, formError: UNEXPECTED });
  }
}
