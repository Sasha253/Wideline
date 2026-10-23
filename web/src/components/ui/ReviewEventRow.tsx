"use client";

import { Check, Pencil, X } from "lucide-react";
import { IconButton } from "./Button";
import { ConfidenceMeter } from "./ConfidenceMeter";
import { EventStatusChip, type EventReviewState } from "./StatusChip";
import { TeamMarker, type Side } from "./TeamMarker";

export type EventWho =
  { kind: "player"; number: number; name: string } | { kind: "track"; trackId: number };

/**
 * One event in the review workspace's event list. Pending rows show confirm,
 * edit and reject buttons whose labels name the shortcut; handled rows show a
 * status chip instead. Only the current row gets aria-current.
 *
 * `pending` and `pending_review` both show the actions: a row waiting for the
 * scout must stay actionable. J/K navigation and the Y/E/N keys belong to the
 * review workspace (C11).
 */
export function ReviewEventRow({
  time,
  type,
  side,
  who,
  note,
  confidence,
  threshold,
  state,
  current = false,
  onConfirm,
  onEdit,
  onReject,
}: {
  /** Match time, e.g. "31:24". */
  time: string;
  type: string;
  side: Side;
  who: EventWho;
  note?: string;
  confidence: number;
  threshold: number;
  state: "pending" | EventReviewState;
  current?: boolean;
  onConfirm?: () => void;
  onEdit?: () => void;
  onReject?: () => void;
}) {
  const pending = state === "pending" || state === "pending_review";
  const whoName =
    who.kind === "player" ? `#${who.number} ${who.name}` : `Unlinked track ${who.trackId}`;

  return (
    <li className="wl-event" aria-current={current ? "true" : undefined}>
      <span className="wl-event__time whitespace-nowrap">{time}</span>
      <span className="wl-event__what">
        <span className="wl-event__type">{type}</span>
        <span className="wl-event__who">
          <TeamMarker side={side} name={whoName} className="font-medium" />
          {note && ` · ${note}`}
        </span>
      </span>
      {pending ? (
        <>
          <ConfidenceMeter score={confidence} threshold={threshold} />
          <span className="wl-row">
            <IconButton icon={Check} tone="ok" aria-label="Confirm (Y)" onClick={onConfirm} />
            <IconButton icon={Pencil} aria-label="Edit (E)" onClick={onEdit} />
            <IconButton icon={X} tone="no" aria-label="Reject (N)" onClick={onReject} />
          </span>
        </>
      ) : (
        <>
          <EventStatusChip state={state} />
          <span aria-hidden="true" />
        </>
      )}
    </li>
  );
}
