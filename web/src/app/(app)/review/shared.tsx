import { Scissors } from "lucide-react";
import { formatDeletionDate, formatTimeLeft } from "@/components/ui/expiry";
import { InlineStatus } from "@/components/ui/ExpiryBanner";
import { CLAIM_DURATION_MS, clipsExpireAt } from "@/lib/review-rules";
import type { QueueRow } from "@/server/review/queue";

// Pieces shared by the C10 review pages (docs/build/design/C10.md). Match-level
// facts only: no venue, no players, no footage (REVIEW11, A-3).

/** 48: the claim length in hours, for the copy. */
export const CLAIM_HOURS = CLAIM_DURATION_MS / (60 * 60 * 1000);

/** "{organisation name} · {ageGroup} · {competition}", missing parts left out. */
export function clubLine(row: QueueRow): string {
  return [row.organisationName, row.ageGroup, row.competition].filter(Boolean).join(" · ");
}

/** "2 × 35 min". */
export function lengthText(row: QueueRow): string {
  return `2 × ${row.halfLengthMinutes} min`;
}

/** "12 events to check", "1 event to check", or "No events to check" in ink-muted. */
export function ToCheckText({ count }: { count: number }) {
  if (count === 0) return <span className="text-ink-muted">No events to check</span>;
  return <>{count === 1 ? "1 event to check" : `${count} events to check`}</>;
}

/** "You can hold 1 claimed match at a time." Nothing when unlimited. */
export function limitSentence(claimLimit: number): string | null {
  if (!Number.isFinite(claimLimit)) return null;
  return `You can hold ${claimLimit} claimed ${claimLimit === 1 ? "match" : "matches"} at a time.`;
}

/**
 * The Raw footage fact (Surfaces 2 and 3): "Deleted Friday 24 Oct, in 2 days",
 * or, clips only, the clips line.
 */
export function RawFootageFact({ row, now }: { row: QueueRow; now: Date }) {
  if (row.clipsOnly) {
    return (
      <InlineStatus tone="muted" icon={Scissors}>
        Deleted. Clips kept until {formatDeletionDate(clipsExpireAt(row.rawExpiresAt))}
      </InlineStatus>
    );
  }
  return (
    <span className="font-mono text-mono-m tabular-nums">
      Deleted {formatDeletionDate(row.rawExpiresAt)}, in{" "}
      {formatTimeLeft(row.rawExpiresAt.getTime() - now.getTime())}
    </span>
  );
}

export const CLIPS_ONLY_NOTICE =
  "Raw footage for this match has been deleted. You can check events against their clips, but you cannot add missed events.";
