import type { ActionResult } from "@/lib/action-result";
import type { ImportPreview } from "@/server/squad/import";

// The CSV import steps as the server actions return them (docs/build/design/C04.md,
// Surface 6). Nothing is stored between steps: the preview carries the text and
// its digest, and the commit sends them back.

export type ImportState =
  | { step: "upload"; result: ActionResult }
  | {
      step: "preview";
      preview: ImportPreview;
      fileName: string;
      /** The squad changed after the check: this is the fresh preview, nothing was imported. */
      stale: boolean;
      result: ActionResult;
    }
  | {
      step: "done";
      created: number;
      skipped: number;
      team: { id: string; label: string };
    }
  | null;
