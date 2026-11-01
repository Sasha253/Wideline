"use client";

import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useSectionAction } from "@/components/section-result";
import { deleteTeamAction } from "../actions";

/** The delete confirmation. Success redirects to the team list; errors stay in the dialog. */
export function DeleteTeam({ teamId, label }: { teamId: string; label: string }) {
  const form = useSectionAction(deleteTeamAction, () => {}, { okOnly: true });
  return (
    <ConfirmDialog
      trigger={{ label: "Delete team", variant: "danger", icon: Trash2 }}
      title={`Delete ${label}?`}
      body="This removes the team. It has no players, matches or lineups, so nothing else changes."
      form={form}
      hidden={{ teamId }}
      submit={{ label: "Delete team", pendingLabel: "Deleting", variant: "danger" }}
    />
  );
}
