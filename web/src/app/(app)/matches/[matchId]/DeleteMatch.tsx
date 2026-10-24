"use client";

import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useSectionAction } from "@/components/section-result";
import { deleteMatchAction } from "./actions";

/**
 * The delete confirmation (MATCH08; docs/build/design/C06.md, Surface 6).
 * Success redirects to the match list; errors stay in the dialog.
 */
export function DeleteMatch({
  matchId,
  fixture,
  date,
  uploading,
}: {
  matchId: string;
  fixture: string;
  date: string;
  uploading: boolean;
}) {
  const form = useSectionAction(deleteMatchAction, () => {}, { okOnly: true });
  return (
    <ConfirmDialog
      trigger={{ label: "Delete match", variant: "danger", icon: Trash2, block: true }}
      title="Delete this match?"
      body={
        <>
          This deletes {fixture} on {date}, with its footage, lineups and markers, and every stat
          and clip from it. You cannot undo this.
          {uploading && " The upload in progress stops."}
        </>
      }
      form={form}
      hidden={{ matchId }}
      submit={{ label: "Delete match", pendingLabel: "Deleting…", variant: "danger" }}
    />
  );
}
