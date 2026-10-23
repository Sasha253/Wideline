import {
  Check,
  CheckCheck,
  CircleAlert,
  CircleDashed,
  Clock,
  Eye,
  LoaderCircle,
  Plus,
  TriangleAlert,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import type { MatchStatus } from "@/generated/prisma/enums";
import { iconProps } from "./icons";

export type ChipTone = "ok" | "warn" | "danger" | "neutral" | "new";

/**
 * A chip shows the state of an event, a match or a job. Every chip pairs a
 * colour with a word and an icon (NFR27), so the icon is required.
 *
 * - Chips are never clickable. Use a filter toggle or a button instead.
 * - Use the `new` tone (floodlight) at most once per list.
 * - Write the label in sentence case; the CSS uppercases it. Two words at most.
 */
export function StatusChip({
  tone,
  icon: Icon,
  label,
}: {
  tone: ChipTone;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <span className={`wl-chip wl-chip--${tone}`}>
      <Icon {...iconProps} />
      {label}
    </span>
  );
}

/**
 * Review state of a detected event. A TS union until C08/C10 add the matching
 * Prisma enum.
 */
export type EventReviewState =
  "confirmed" | "auto_accepted" | "pending_review" | "rejected" | "manual";

type Preset = { tone: ChipTone; icon: LucideIcon; label: string };

export const EVENT_STATES: Record<EventReviewState, Preset> = {
  confirmed: { tone: "ok", icon: Check, label: "Confirmed" },
  auto_accepted: { tone: "ok", icon: CheckCheck, label: "Auto-accepted" },
  pending_review: { tone: "warn", icon: TriangleAlert, label: "Pending review" },
  rejected: { tone: "danger", icon: X, label: "Rejected" },
  manual: { tone: "ok", icon: Plus, label: "Manual" },
};

// Tones follow the StatusChip README: warn needs attention, neutral is in
// progress, danger failed. LoaderCircle is static: nothing spins.
export const MATCH_STATES: Record<MatchStatus, Preset> = {
  draft: { tone: "neutral", icon: CircleDashed, label: "Draft" },
  uploading: { tone: "neutral", icon: Upload, label: "Uploading" },
  processing: { tone: "neutral", icon: LoaderCircle, label: "Processing" },
  awaiting_review: { tone: "warn", icon: Clock, label: "Awaiting review" },
  in_review: { tone: "neutral", icon: Eye, label: "In review" },
  published: { tone: "ok", icon: Check, label: "Published" },
  failed: { tone: "danger", icon: CircleAlert, label: "Failed" },
};

export function EventStatusChip({ state }: { state: EventReviewState }) {
  return <StatusChip {...EVENT_STATES[state]} />;
}

export function MatchStatusChip({ status }: { status: MatchStatus }) {
  return <StatusChip {...MATCH_STATES[status]} />;
}
