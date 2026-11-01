"use client";

import { Check, CheckCheck, Clock, Pencil, Plus, User, X } from "lucide-react";
import type { ReactNode } from "react";
import { LOW_CONFIDENCE } from "./ConfidenceMeter";
import { cx } from "./cx";
import { iconProps } from "./icons";
import type { EventReviewState } from "./StatusChip";
import type { Side } from "./TeamMarker";

export type EventWho =
  { kind: "player"; number: number; name: string } | { kind: "track"; trackId: number } | string;

/**
 * The shapes of an event's state: dashed pending, solid confirmed (a person checked it),
 * struck rejected, and two outline discs that are settled but not checked by a person in
 * this list: auto-accepted (the model, above its threshold) and added (a scout added it).
 * Each carries colour, icon and word (title and sr-only), never colour alone.
 */
export type EventDisc = "pending" | "confirmed" | "rejected" | "auto" | "added";

/** Which disc an event state shows. */
export function eventDisc(state: "pending" | EventReviewState): EventDisc {
  if (state === "rejected") return "rejected";
  if (state === "pending" || state === "pending_review") return "pending";
  if (state === "auto_accepted") return "auto";
  if (state === "manual") return "added";
  return "confirmed";
}

const DISC: Record<EventDisc, { icon: typeof Check; label: string }> = {
  confirmed: { icon: Check, label: "Confirmed" },
  pending: { icon: Clock, label: "Pending" },
  rejected: { icon: X, label: "Rejected" },
  auto: { icon: CheckCheck, label: "Auto-accepted" },
  added: { icon: Plus, label: "Added by a scout" },
};

/** "8 S. Ndlovu", or "Unlinked track 12". */
export function whoLabel(who: EventWho): string {
  if (typeof who === "string") return who;
  return who.kind === "player" ? `${who.number} ${who.name}` : `Unlinked track ${who.trackId}`;
}

/** The confidence score under which the meter turns pending (Floodlight: 0.50). */
export { LOW_CONFIDENCE };

/** How long a caller keeps `saved` true: the flash is 600ms, the reduced-motion check 1.2s. */
export const SAVED_MS = 1200;

/**
 * The column header for a list of ReviewEventRows: Time, side, Event, Conf, status.
 * Put it above the `ul`, inside the same panel (`wl-elist`).
 */
export function ReviewEventListHeader() {
  return (
    <div className="wl-elist__head" aria-hidden="true">
      <span>Time</span>
      <span />
      <span>Event</span>
      <span>Conf</span>
      <span />
    </div>
  );
}

/**
 * One event in the review workspace (Floodlight, "Review event row"). A 42px row: time,
 * H/A, type, who, a 10-segment confidence meter and a status disc (56px on phones).
 *
 * - `selected` (J/K in the workspace) opens the row in place with Confirm Y, Reject N and
 *   Edit E. Every shortcut has a visible button. Selection is ink with a 1px focus inset;
 *   Tab focus is a separate 2px inset ring.
 * - Rejected rows stay in place, struck through and muted. Edited rows say "Edited" (hover
 *   shows what changed). `saved` flashes brand-subtle for 600ms. The list never reorders:
 *   the caller keeps match order.
 * - `onSelect` makes the row a button (click selects). Keyboard shortcuts belong to the
 *   workspace, not the row.
 */
export function ReviewEventRow({
  time,
  type,
  side,
  who,
  note,
  confidence,
  source = "model",
  state,
  selected,
  current,
  saved = false,
  edited = false,
  editedFrom,
  facts,
  onSelect,
  onConfirm,
  onEdit,
  onReject,
  className,
}: {
  /** Match time, e.g. "31:24". */
  time: string;
  type: string;
  /** Null when the side is not set (C11): no marker, "Side not set" for screen readers. */
  side: Side | null;
  who: EventWho;
  /** A short note after who ("corrected"). */
  note?: string;
  /** 0 to 1. Leave out (or use source="scout") for an event a scout added. */
  confidence?: number | null;
  /** @deprecated The meter turns pending under 0.50 (LOW_CONFIDENCE), whatever the threshold. */
  threshold?: number;
  /** "scout": added by a scout; no model score, shows "Scout". */
  source?: "model" | "scout";
  state: "pending" | EventReviewState;
  selected?: boolean;
  /** @deprecated Use `selected`. */
  current?: boolean;
  /** True for SAVED_MS after a save: flashes brand-subtle (a check under reduced motion). */
  saved?: boolean;
  /** Confirmed after a change. */
  edited?: boolean;
  /** What it was before the edit, for the hover title ("4 L. Mahlangu"). */
  editedFrom?: string;
  /** Two facts shown when the row is open: ["Ball over the line at 31:24.6", "Scorer matched by shirt number"]. */
  facts?: [ReactNode, ReactNode?];
  onSelect?: () => void;
  onConfirm?: () => void;
  onEdit?: () => void;
  onReject?: () => void;
  className?: string;
}) {
  const isSelected = selected ?? current ?? false;
  const disc = eventDisc(state);
  const manual = source === "scout" || state === "manual" || confidence == null;
  const score = manual ? null : Math.min(1, Math.max(0, confidence ?? 0));
  const low = score !== null && score < LOW_CONFIDENCE;
  const on = score === null ? 0 : Math.round(score * 10);
  const Disc = DISC[disc].icon;
  // C11: an event whose side is not set has no marker (docs/build/design/C11.md, "Side").
  const sideWord = side === "home" ? "Home" : side === "away" ? "Away" : "Side not set";

  const line = (
    <>
      <span className="wl-erow__time">{time}</span>
      {side ? (
        <span className={cx("wl-side", side === "home" ? "wl-side--home" : "wl-side--away")}>
          <span aria-hidden="true">{side === "home" ? "H" : "A"}</span>
          <span className="sr-only">{sideWord}</span>
        </span>
      ) : (
        <span className="wl-side">
          <span className="sr-only">{sideWord}</span>
        </span>
      )}
      <span className="wl-erow__what">
        <span className="wl-erow__type">
          {type}
          {disc === "rejected" && <span className="sr-only"> (rejected)</span>}
        </span>
        <span className="wl-erow__who">
          {whoLabel(who)}
          {note && ` · ${note}`}
        </span>
        {edited && (
          <span className="wl-erow__edited" title={editedFrom ? `was ${editedFrom}` : undefined}>
            <Pencil {...iconProps} />
            Edited
            {editedFrom && <span className="sr-only">, was {editedFrom}</span>}
          </span>
        )}
        <span className="wl-erow__saved" aria-hidden="true">
          <Check {...iconProps} />
          Saved
        </span>
      </span>
      <span className="wl-erow__conf">
        {score === null ? (
          <span className="wl-erow__scout">
            <User {...iconProps} />
            Scout
          </span>
        ) : (
          <>
            <span className={cx("wl-meter", low && "wl-meter--low")} aria-hidden="true">
              {Array.from({ length: 10 }, (_, i) => (
                <i key={i} data-on={i < on ? "" : undefined} />
              ))}
            </span>
            <span className="wl-erow__score">
              <span className="sr-only">Confidence </span>
              {score.toFixed(2)}
              {low && <span className="sr-only">, low</span>}
            </span>
          </>
        )}
      </span>
      <span className={`wl-disc wl-disc--${disc}`} title={DISC[disc].label}>
        <Disc {...iconProps} />
        <span className="sr-only">{DISC[disc].label}</span>
      </span>
    </>
  );

  const actions = isSelected && (onConfirm || onReject || onEdit);

  return (
    <li
      className={cx(
        "wl-erow",
        isSelected && "wl-erow--selected",
        disc === "rejected" && "wl-erow--rejected",
        saved && "wl-erow--saved",
        className,
      )}
      aria-current={isSelected ? "true" : undefined}
    >
      {onSelect ? (
        <button
          type="button"
          className="wl-erow__line"
          aria-expanded={isSelected}
          onClick={onSelect}
        >
          {line}
        </button>
      ) : (
        <div className="wl-erow__line">{line}</div>
      )}
      {isSelected && (facts || actions) && (
        <div className="wl-erow__open">
          {facts && (
            <div className="wl-erow__facts">
              <span>{facts[0]}</span>
              {facts[1] && <span>{facts[1]}</span>}
            </div>
          )}
          {actions && (
            <div className="wl-erow__actions">
              {onConfirm && (
                <button
                  type="button"
                  className="wl-erow__act wl-erow__act--primary"
                  aria-keyshortcuts="Y"
                  onClick={onConfirm}
                >
                  <span>
                    <Check {...iconProps} />
                    Confirm
                  </span>
                  <kbd aria-hidden="true">Y</kbd>
                </button>
              )}
              {onReject && (
                <button
                  type="button"
                  className="wl-erow__act"
                  aria-keyshortcuts="N"
                  onClick={onReject}
                >
                  <span>
                    <X {...iconProps} />
                    Reject
                  </span>
                  <kbd aria-hidden="true">N</kbd>
                </button>
              )}
              {onEdit && (
                <button
                  type="button"
                  className="wl-erow__act"
                  aria-keyshortcuts="E"
                  onClick={onEdit}
                >
                  <span>
                    <Pencil {...iconProps} />
                    Edit
                  </span>
                  <kbd aria-hidden="true">E</kbd>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
