"use client";

import { Check } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useSectionAction } from "@/components/section-result";
import { Button } from "@/components/ui/Button";
import type { WorkspaceCounts } from "@/lib/review-workspace";
import { submitReviewAction } from "./actions";

/** "3 events left to check", "1 event left to check". */
export function leftText(n: number): string {
  return n === 1 ? "1 event left to check" : `${n} events left to check`;
}

/**
 * Mark as reviewed (REVIEW08; Floodlight, Screens B "Workspace · desktop"). While events
 * are left to check, the button stays disabled and says how many are left ("32 left");
 * it is aria-disabled, so it stays focusable, and activating it selects the first pending
 * event instead (onBlocked). The dialog posts to submitReviewAction, which publishes and
 * redirects to the ended claim; events_pending shows in the dialog.
 */
export function SubmitReview({
  claimId,
  remaining,
  counts,
  onBlocked,
  block = false,
}: {
  claimId: string;
  remaining: number;
  counts: WorkspaceCounts;
  onBlocked: () => void;
  /** Full width (the phone footer). */
  block?: boolean;
}) {
  const form = useSectionAction(submitReviewAction, () => {}, { okOnly: true });
  if (remaining > 0) {
    return (
      <Button
        variant="secondary"
        size="m"
        block={block}
        className="whitespace-nowrap"
        aria-disabled="true"
        aria-label={`Mark as reviewed. ${leftText(remaining)}.`}
        onClick={onBlocked}
      >
        Mark as reviewed
        <span className="font-mono text-mono-m tabular-nums" aria-hidden="true">
          {remaining} left
        </span>
      </Button>
    );
  }
  return (
    <ConfirmDialog
      trigger={{ label: "Mark as reviewed", variant: "primary", icon: Check, block }}
      title="Mark this match as reviewed?"
      body="The events you checked are published to player profiles, and your access to this match's footage ends. You cannot change your review after this."
      form={form}
      hidden={{ claimId }}
      submit={{ label: "Mark as reviewed", pendingLabel: "Publishing…", variant: "primary" }}
    >
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
        <dt className="font-mono text-overline text-ink-muted uppercase">Events checked</dt>
        <dd className="m-0 font-mono text-mono-m tabular-nums">
          {counts.eventsReviewed - counts.added}
        </dd>
        <dt className="font-mono text-overline text-ink-muted uppercase">Corrections</dt>
        <dd className="m-0 font-mono text-mono-m tabular-nums">
          {counts.corrections - counts.added}
        </dd>
        <dt className="font-mono text-overline text-ink-muted uppercase">Missed events added</dt>
        <dd className="m-0 font-mono text-mono-m tabular-nums">{counts.added}</dd>
      </dl>
    </ConfirmDialog>
  );
}
