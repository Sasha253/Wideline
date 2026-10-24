"use client";

import { UserMinus } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useSectionAction } from "@/components/section-result";
import { DEPARTURE_UNDO_DAYS } from "@/lib/squad-fields";
import { markDepartedAction } from "../actions";

/**
 * The departure confirmation (SQUAD09; docs/build/design/C04.md, Surface 5).
 * Success redirects to the read-only player page; errors stay in the dialog.
 */
export function DepartPlayer({
  playerId,
  name,
  firstName,
}: {
  playerId: string;
  name: string;
  firstName: string;
}) {
  const form = useSectionAction(markDepartedAction, () => {}, { okOnly: true });
  return (
    <ConfirmDialog
      trigger={{ label: "Mark as departed", variant: "danger", icon: UserMinus }}
      title={`Mark ${name} as departed?`}
      body={`${firstName} leaves the squad list, lineup pickers and club dashboards. No data is deleted: their matches, stats and consent records stay. After this, the club cannot edit ${firstName}'s details. You can undo the departure for ${DEPARTURE_UNDO_DAYS} days.`}
      form={form}
      hidden={{ playerId }}
      submit={{ label: "Mark as departed", pendingLabel: "Saving…", variant: "danger" }}
    />
  );
}
