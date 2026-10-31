"use client";

import { Undo2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useSectionAction } from "@/components/section-result";
import { releaseClaimAction } from "../../actions";

/**
 * Release match (REVIEW01; docs/build/design/C10.md, Surface 3). Success
 * redirects to the queue; a claim that has already ended redirects to its own
 * page; other errors stay in the dialog, where focus already is (closeOnError
 * stays false).
 */
export function ReleaseClaim({ claimId }: { claimId: string }) {
  const form = useSectionAction(releaseClaimAction, () => {}, { okOnly: true });
  return (
    <ConfirmDialog
      trigger={{ label: "Release match", variant: "secondary", icon: Undo2, block: true }}
      title="Release this match?"
      body="The match goes back to the queue for other scouts. Any corrections you made stay."
      form={form}
      hidden={{ claimId }}
      submit={{ label: "Release match", pendingLabel: "Releasing…", variant: "primary" }}
    />
  );
}
