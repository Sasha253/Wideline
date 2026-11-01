import { Clock, Scissors, Timer, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";
import { ExpiryBannerLive } from "./ExpiryChip";
import { expiryLevel, formatTimeLeft } from "./expiry";
import { iconProps } from "./icons";

/**
 * Raw footage is deleted on a fixed schedule, so time left is always visible (Floodlight,
 * "Expiry banner"). It sits under the workspace header and can't be dismissed.
 *
 * - More than 3 days: neutral, "Raw footage for this match is kept until 12 Nov 2026."
 * - 3 days or less: pending, "… is deleted in 2 days. Review it before then to add missed
 *   events."
 * - Under 24 hours: rejected, `role=alert`, "… is deleted in 9 hours. After that, missed
 *   events can't be added."
 * - Deleted (past `deletesAt`, or `deleted`): lock, "Raw footage was deleted on 28 Oct 2026.
 *   Confirmed clips are kept. Missed events can no longer be added."
 *
 * The countdown on the right updates once a minute from the server time (`now`) and is not
 * announced; screen readers hear the message when the page loads and when the step changes.
 * `children` replaces the default consequence after the first sentence.
 *
 * Server-safe: the ticking half is ExpiryBannerLive in ./ExpiryChip.
 */
export function ExpiryBanner({
  deletesAt,
  expiresAt,
  now,
  deleted,
  children,
  className,
}: {
  /** When the raw footage is deleted. Shows every step, neutral included. */
  deletesAt?: Date;
  /**
   * @deprecated Use `deletesAt`. With `expiresAt` the banner keeps its old behaviour and
   * renders nothing above 72 hours.
   */
  expiresAt?: Date;
  /** The server's time at render. */
  now?: Date;
  deleted?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const at = deletesAt ?? expiresAt;
  if (!at) return null;
  return (
    <ExpiryBannerLive
      deletesAt={at}
      now={now}
      deleted={deleted}
      hideNeutral={!deletesAt}
      className={className}
    >
      {children}
    </ExpiryBannerLive>
  );
}

/**
 * @deprecated Use ExpiryChip (every step, updates once a minute). The compact clock-and-time
 * label for review queue rows; nothing above 72h.
 */
export function ExpiryLabel({ expiresAt, now = new Date() }: { expiresAt: Date; now?: Date }) {
  const level = expiryLevel(expiresAt, now);
  if (level === "none") return null;

  const left = expiresAt.getTime() - now.getTime();
  return (
    <span className={`wl-chip wl-chip--${level === "danger" ? "danger" : "warn"}`}>
      <Clock {...iconProps} />
      {left <= 0 ? (
        "Due now"
      ) : (
        <>
          <span className="sr-only">Footage deleted in </span>
          {formatTimeLeft(left)}
        </>
      )}
    </span>
  );
}

const HOUR = 60 * 60 * 1000;

/**
 * A small icon-and-words status line (`wl-inline-status`), never a live
 * region. Shared by the C06 match rows and the C10 time-left pieces.
 */
export function InlineStatus({
  tone,
  icon: Icon,
  children,
}: {
  tone: "muted" | "warn" | "danger";
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span className={cx("wl-inline-status text-body-s", `wl-inline-status--${tone}`)}>
      <Icon {...iconProps} />
      {children}
    </span>
  );
}

/*
 * Time-left pieces (docs/build/design/C10.md, "Time-left pieces"). Server-safe
 * and static: `now` comes from the page's render, nothing ticks and nothing is
 * announced. Clock is for footage, Timer for the claim, Scissors for clips,
 * and the words always say which one is meant.
 */

/** Raw footage left: muted words above 72 h, the ExpiryLabel chip from 72 h down. */
export function FootageTimeLeft({ expiresAt, now }: { expiresAt: Date; now: Date }) {
  if (expiryLevel(expiresAt, now) !== "none")
    return <ExpiryLabel expiresAt={expiresAt} now={now} />;
  return (
    <InlineStatus tone="muted" icon={Clock}>
      Footage deleted in {formatTimeLeft(expiresAt.getTime() - now.getTime())}
    </InlineStatus>
  );
}

/** A claim's time left: muted from 12 h, warn under 12 h, nothing once it has ended. */
export function ClaimTimeLeft({ expiresAt, now }: { expiresAt: Date; now: Date }) {
  const left = expiresAt.getTime() - now.getTime();
  if (left <= 0) return null;
  return (
    <InlineStatus tone={left < 12 * HOUR ? "warn" : "muted"} icon={Timer}>
      Claim ends in {formatTimeLeft(left)}
    </InlineStatus>
  );
}

/** A clips-only match's clips left: muted from 24 h, danger under 24 h, nothing once gone. */
export function ClipsTimeLeft({ clipsExpireAt, now }: { clipsExpireAt: Date; now: Date }) {
  const left = clipsExpireAt.getTime() - now.getTime();
  if (left <= 0) return null;
  return (
    <InlineStatus tone={left < 24 * HOUR ? "danger" : "muted"} icon={Scissors}>
      Clips deleted in {formatTimeLeft(left)}
    </InlineStatus>
  );
}
