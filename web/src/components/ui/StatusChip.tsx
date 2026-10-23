import {
  Ban,
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
import type { MatchStatus, OrganisationStatus } from "@/generated/prisma/enums";
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

/** Derived invitation state (src/server/organisations/invitations.ts). */
export type InvitationState = "pending" | "expired" | "accepted" | "revoked";

export const INVITATION_STATES: Record<InvitationState, Preset> = {
  pending: { tone: "warn", icon: Clock, label: "Pending" },
  expired: { tone: "neutral", icon: CircleDashed, label: "Expired" },
  accepted: { tone: "ok", icon: Check, label: "Accepted" },
  revoked: { tone: "danger", icon: X, label: "Revoked" },
};

// Keyed by the Prisma enum, so a new organisation status fails to compile here.
export const ORGANISATION_STATES: Record<OrganisationStatus, Preset> = {
  pending: { tone: "warn", icon: Clock, label: "Pending" },
  active: { tone: "ok", icon: Check, label: "Active" },
  rejected: { tone: "danger", icon: X, label: "Rejected" },
  suspended: { tone: "danger", icon: Ban, label: "Suspended" },
};

export function EventStatusChip({ state }: { state: EventReviewState }) {
  return <StatusChip {...EVENT_STATES[state]} />;
}

export function MatchStatusChip({ status }: { status: MatchStatus }) {
  return <StatusChip {...MATCH_STATES[status]} />;
}

export function InvitationStatusChip({ state }: { state: InvitationState }) {
  return <StatusChip {...INVITATION_STATES[state]} />;
}

export function OrganisationStatusChip({ status }: { status: OrganisationStatus }) {
  return <StatusChip {...ORGANISATION_STATES[status]} />;
}
