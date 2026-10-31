import { Clock, Scissors, Timer, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";
import { expiryLevel, formatTimeLeft } from "./expiry";
import { iconProps } from "./icons";

/**
 * Warns that a match's raw footage is about to be deleted. Nothing above 72h,
 * warning (role=status) from 72h down to 24h, danger (role=alert) under 24h.
 *
 * `children` carries the consequence, for example:
 * - warning: "Review this match before {formatDeletionDate(expiresAt)} to add
 *   missed events. Stats you confirm are kept."
 * - danger, unclaimed: "This match has no reviewer yet. Claim it now or it will
 *   publish with auto-accepted events only."
 */
export function ExpiryBanner({
  expiresAt,
  now = new Date(),
  children,
}: {
  expiresAt: Date;
  now?: Date;
  children?: ReactNode;
}) {
  const level = expiryLevel(expiresAt, now);
  if (level === "none") return null;

  const left = expiresAt.getTime() - now.getTime();
  const danger = level === "danger";
  const Icon = danger ? TriangleAlert : Clock;
  return (
    <div
      className={cx("wl-banner", danger && "wl-banner--danger")}
      role={danger ? "alert" : "status"}
    >
      <Icon {...iconProps} />
      <div>
        <b>
          {left <= 0
            ? "Footage is due for deletion now."
            : `Footage deleted in ${formatTimeLeft(left)}.`}
        </b>
        {children && <> {children}</>}
      </div>
    </div>
  );
}

/** The compact clock-and-time label for review queue rows. Nothing above 72h. */
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
    <span className={cx("wl-inline-status caption", `wl-inline-status--${tone}`)}>
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
