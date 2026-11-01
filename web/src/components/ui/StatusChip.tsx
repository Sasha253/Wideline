import {
  Ban,
  Check,
  CheckCheck,
  CircleAlert,
  CircleDashed,
  CircleOff,
  Clock,
  Eye,
  File,
  LoaderCircle,
  Plus,
  RotateCcw,
  Timer,
  TimerOff,
  TriangleAlert,
  Undo2,
  Upload,
  UserMinus,
  X,
  type LucideIcon,
} from "lucide-react";
import type {
  ClubStatus,
  MatchStatus,
  OrganisationStatus,
  ProcessingJobStatus,
  ReviewClaimStatus,
  ScoutStatus,
  VideoStatus,
} from "@/generated/prisma/enums";
import { cx } from "./cx";
import { iconProps } from "./icons";

/**
 * Every state maps to one of these. Shape carries the meaning as well as colour
 * (docs/design-handoff/README.md, "Never colour alone"):
 *
 * - ok: solid confirmed fill. Settled (reviewed, confirmed, active).
 * - warn: 1.5px dashed pending outline. Waiting on a person (ready for review, pending).
 * - system: thin control outline, ink text. Waiting on the system (uploading, processing).
 * - danger: rejected-subtle fill. Failed, rejected, revoked.
 * - neutral: thin line-strong outline, muted text. Inactive (draft, expired, departed, off).
 * - new: brand-subtle fill with a brand-text edge. Claimed and being worked on (In review).
 */
export type ChipTone = "ok" | "warn" | "system" | "danger" | "neutral" | "new";

/** m 26px (headers, cards), s 20px (dense table cells), disc 20px round (review event rows). */
export type ChipSize = "m" | "s" | "disc";

type Preset = { tone: ChipTone; icon: LucideIcon; label: string; struck?: boolean };

/**
 * Review state of a detected event. confirmed / pending / rejected are the Floodlight
 * names; auto_accepted, pending_review and manual are the older names, still accepted.
 */
export type EventReviewState =
  "confirmed" | "pending" | "rejected" | "auto_accepted" | "pending_review" | "manual";

export const EVENT_STATES: Record<EventReviewState, Preset> = {
  confirmed: { tone: "ok", icon: Check, label: "Confirmed" },
  pending: { tone: "warn", icon: Clock, label: "Pending" },
  rejected: { tone: "danger", icon: X, label: "Rejected", struck: true },
  auto_accepted: { tone: "ok", icon: CheckCheck, label: "Auto-accepted" },
  pending_review: { tone: "warn", icon: Clock, label: "Pending" },
  manual: { tone: "ok", icon: Plus, label: "Manual" },
};

/** Match status names from the design (ready, reviewed) alongside the Prisma enum. */
export type MatchChipStatus = MatchStatus | "ready" | "reviewed";

// Floodlight match status (Wideline Components.dc.html, "Match status"). The loader spins;
// reduced motion stops it.
export const MATCH_STATES: Record<MatchStatus, Preset> = {
  draft: { tone: "neutral", icon: File, label: "Draft" },
  uploading: { tone: "system", icon: Upload, label: "Uploading" },
  processing: { tone: "system", icon: LoaderCircle, label: "Processing" },
  awaiting_review: { tone: "warn", icon: Clock, label: "Ready for review" },
  in_review: { tone: "new", icon: Eye, label: "In review" },
  published: { tone: "ok", icon: Check, label: "Reviewed" },
  failed: { tone: "danger", icon: TriangleAlert, label: "Failed" },
};

function matchPreset(status: MatchChipStatus): Preset {
  if (status === "ready") return MATCH_STATES.awaiting_review;
  if (status === "reviewed") return MATCH_STATES.published;
  return MATCH_STATES[status];
}

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

// Scout registration (docs/build/design/C02.md, Surface 6). "Not approved" reads less
// harshly to the scout than "Rejected"; the tone stays danger, as for organisations.
export const SCOUT_STATES: Record<ScoutStatus, Preset> = {
  pending: { tone: "warn", icon: Clock, label: "Awaiting approval" },
  approved: { tone: "ok", icon: Check, label: "Approved" },
  suspended: { tone: "danger", icon: Ban, label: "Suspended" },
  rejected: { tone: "danger", icon: X, label: "Not approved" },
};

// Feature flag states on the admin flags and limits page (docs/build/design/C03.md).
export const FLAG_STATES: Record<"on" | "off", Preset> = {
  on: { tone: "ok", icon: Check, label: "On" },
  off: { tone: "neutral", icon: CircleOff, label: "Off" },
};

// A player's club status (docs/build/design/C04.md). Current is the normal state, so it
// carries no chip.
export const CLUB_STATES: Record<ClubStatus, Preset | null> = {
  active: null,
  departed: { tone: "neutral", icon: UserMinus, label: "Departed" },
};

/** A video's state, with accepted split by whether the footage check warned (C06). */
export type FootageState = VideoStatus | "accepted_with_warnings";

// Footage of a match (docs/build/design/C06.md, "Chip preset").
export const FOOTAGE_STATES: Record<FootageState, Preset> = {
  uploading: { tone: "system", icon: Upload, label: "Uploading" },
  probing: { tone: "system", icon: LoaderCircle, label: "Checking footage" },
  accepted: { tone: "ok", icon: Check, label: "Accepted" },
  accepted_with_warnings: { tone: "warn", icon: TriangleAlert, label: "With warnings" },
  rejected: { tone: "danger", icon: X, label: "Rejected" },
  cancelled: { tone: "neutral", icon: CircleOff, label: "Cancelled" },
};

/**
 * A processing job's state (docs/build/design/C09.md, "Chip preset"): queued after a
 * failed attempt reads Retrying.
 */
export type JobChipState = ProcessingJobStatus | "retrying";

export const JOB_STATES: Record<JobChipState, Preset> = {
  queued: { tone: "system", icon: CircleDashed, label: "Queued" },
  retrying: { tone: "warn", icon: RotateCcw, label: "Retrying" },
  running: { tone: "system", icon: LoaderCircle, label: "Running" },
  succeeded: { tone: "ok", icon: Check, label: "Succeeded" },
  failed: { tone: "danger", icon: CircleAlert, label: "Failed" },
};

/**
 * A review claim's state (docs/build/design/C10.md, "Chip preset"). Active is warn: the
 * claim has a deadline and needs the scout's attention.
 */
export const CLAIM_STATES: Record<ReviewClaimStatus, Preset> = {
  active: { tone: "warn", icon: Timer, label: "Claimed" },
  submitted: { tone: "ok", icon: Check, label: "Reviewed" },
  released: { tone: "neutral", icon: Undo2, label: "Released" },
  expired: { tone: "neutral", icon: TimerOff, label: "Expired" },
};

type ChipLook = {
  size?: ChipSize;
  /** Live progress inside the chip, 0 to 100: "Uploading 62%". */
  progress?: number;
  className?: string;
};

type GenericChipProps = ChipLook & {
  tone: ChipTone;
  icon: LucideIcon;
  label: string;
  /** Strike the word through. Only for a rejected event. */
  struck?: boolean;
  kind?: undefined;
};

type MatchChipProps = ChipLook & { kind: "match"; status: MatchChipStatus };
type EventChipProps = ChipLook & { kind: "event"; status: EventReviewState };

export type StatusChipProps = GenericChipProps | MatchChipProps | EventChipProps;

function presetOf(props: StatusChipProps): Preset {
  if (props.kind === "match") return matchPreset(props.status);
  if (props.kind === "event") return EVENT_STATES[props.status];
  return { tone: props.tone, icon: props.icon, label: props.label, struck: props.struck };
}

/**
 * A status chip reports state. It is never a button and has no hover or focus. Every
 * chip pairs colour, icon and word, and the shape carries the meaning too (ChipTone).
 *
 * Either pass a preset (`kind="match" status="processing"`, `kind="event"
 * status="rejected"`) or the parts (`tone`, `icon`, `label`). Sizes: m 26px in headers
 * and cards, s 20px in dense table cells, disc only in review event rows, where the
 * column header names it (the disc carries the word as its accessible name and tooltip).
 */
export function StatusChip(props: StatusChipProps) {
  const { tone, icon: Icon, label, struck } = presetOf(props);
  const size = props.size ?? "m";
  const spin = Icon === LoaderCircle;
  if (size === "disc") {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className={cx("wl-chip", `wl-chip--${tone}`, "wl-chip--disc", props.className)}
      >
        <Icon {...iconProps} className={spin ? "wl-spin" : undefined} />
      </span>
    );
  }
  const progress =
    props.progress === undefined ? null : Math.round(Math.min(100, Math.max(0, props.progress)));
  return (
    <span
      className={cx("wl-chip", `wl-chip--${tone}`, size === "s" && "wl-chip--s", props.className)}
    >
      <Icon {...iconProps} className={spin ? "wl-spin" : undefined} />
      {struck ? <s className="wl-chip__struck">{label}</s> : label}
      {progress !== null && <span className="wl-chip__num">{progress}%</span>}
    </span>
  );
}

export function jobChipState(status: ProcessingJobStatus, attempts: number): JobChipState {
  return status === "queued" && attempts >= 1 ? "retrying" : status;
}

export function JobStatusChip({
  status,
  attempts,
  size,
}: {
  status: ProcessingJobStatus;
  attempts: number;
  size?: ChipSize;
}) {
  return <StatusChip {...JOB_STATES[jobChipState(status, attempts)]} size={size} />;
}

export function EventStatusChip({ state, size }: { state: EventReviewState; size?: ChipSize }) {
  return <StatusChip kind="event" status={state} size={size} />;
}

export function MatchStatusChip({
  status,
  size,
  progress,
}: {
  status: MatchChipStatus;
  size?: ChipSize;
  progress?: number;
}) {
  return <StatusChip kind="match" status={status} size={size} progress={progress} />;
}

export function InvitationStatusChip({ state, size }: { state: InvitationState; size?: ChipSize }) {
  return <StatusChip {...INVITATION_STATES[state]} size={size} />;
}

export function OrganisationStatusChip({
  status,
  size,
}: {
  status: OrganisationStatus;
  size?: ChipSize;
}) {
  return <StatusChip {...ORGANISATION_STATES[status]} size={size} />;
}

export function ScoutStatusChip({ status, size }: { status: ScoutStatus; size?: ChipSize }) {
  return <StatusChip {...SCOUT_STATES[status]} size={size} />;
}

export function FlagStateChip({ on, size }: { on: boolean; size?: ChipSize }) {
  return <StatusChip {...FLAG_STATES[on ? "on" : "off"]} size={size} />;
}

export function ClaimStatusChip({ status, size }: { status: ReviewClaimStatus; size?: ChipSize }) {
  return <StatusChip {...CLAIM_STATES[status]} size={size} />;
}

export function FootageChip({
  state,
  size,
  progress,
}: {
  state: FootageState;
  size?: ChipSize;
  progress?: number;
}) {
  return <StatusChip {...FOOTAGE_STATES[state]} size={size} progress={progress} />;
}

/** Departed players only; renders nothing for a current player. */
export function ClubStatusChip({ status, size }: { status: ClubStatus; size?: ChipSize }) {
  const preset = CLUB_STATES[status];
  return preset ? <StatusChip {...preset} size={size} /> : null;
}
