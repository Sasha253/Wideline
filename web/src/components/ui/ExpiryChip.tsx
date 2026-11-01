"use client";

import { Clock, Lock, TriangleAlert, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cx } from "./cx";
import {
  EXPIRY_CONSEQUENCE,
  expiryLead,
  expiryStep,
  formatCountdown,
  formatCountdownWords,
  type ExpiryStep,
} from "./expiry";
import { iconProps } from "./icons";

const MINUTE = 60 * 1000;

const ICON: Record<ExpiryStep, LucideIcon> = {
  neutral: Clock,
  pending: Clock,
  urgent: TriangleAlert,
  deleted: Lock,
};

/**
 * The server's `now`, moved on once a minute on the client. The first render uses the
 * server time as given, so it hydrates cleanly; after that the clock keeps the server's
 * offset from the browser's clock. Never ticks seconds.
 */
export function useMinuteClock(serverNow: Date | undefined): Date {
  const serverMs = serverNow?.getTime();
  // Lazy initialiser: Date.now() runs once, not on every render (react-hooks/purity).
  const [initial] = useState(() => serverMs ?? Date.now());
  const start = serverMs ?? initial;
  const [now, setNow] = useState(start);
  useEffect(() => {
    const offset = start - Date.now();
    const id = setInterval(() => setNow(Date.now() + offset), MINUTE);
    return () => clearInterval(id);
  }, [start]);
  return new Date(now);
}

/**
 * The countdown chip on queue cards and match rows (Floodlight, "Expiry banner"). The
 * step's colour, icon and wording change together: "12 d" neutral outline, "1 d 22 h"
 * dashed pending, "8 h 41 m" rejected, "Footage deleted" with a lock. Updates once a
 * minute; not a live region.
 */
export function ExpiryChip({
  deletesAt,
  now,
  deleted = false,
  className,
}: {
  deletesAt: Date;
  /** The server's time at render. */
  now?: Date;
  /** The footage is gone (the server knows), even if `deletesAt` is in the future. */
  deleted?: boolean;
  className?: string;
}) {
  const clock = useMinuteClock(now);
  const step = expiryStep(deletesAt, clock, deleted);
  const left = deletesAt.getTime() - clock.getTime();
  const Icon = ICON[step];
  return (
    <span className={cx("wl-xchip", `wl-xchip--${step}`, className)}>
      <Icon {...iconProps} />
      {step === "deleted" ? (
        "Footage deleted"
      ) : (
        <>
          <span aria-hidden="true">{formatCountdown(left)}</span>
          <span className="sr-only">Footage deleted in {formatCountdownWords(left)}</span>
        </>
      )}
    </span>
  );
}

/**
 * The live banner behind ExpiryBanner. Import ExpiryBanner instead; this is the client
 * half, so that ExpiryBanner's module stays server-safe.
 */
export function ExpiryBannerLive({
  deletesAt,
  now,
  deleted = false,
  hideNeutral = false,
  children,
  className,
}: {
  deletesAt: Date;
  now?: Date;
  deleted?: boolean;
  hideNeutral?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const clock = useMinuteClock(now);
  const step = expiryStep(deletesAt, clock, deleted);
  if (hideNeutral && step === "neutral") return null;

  const left = deletesAt.getTime() - clock.getTime();
  const Icon = ICON[step];
  const lead = expiryLead(step, deletesAt, clock);
  const consequence = children ?? EXPIRY_CONSEQUENCE[step];
  return (
    <div
      className={cx("wl-expiry", `wl-expiry--${step}`, className)}
      role={step === "urgent" ? "alert" : "status"}
    >
      <Icon {...iconProps} />
      <span className="wl-expiry__msg">
        {lead}
        {consequence ? <> {consequence}</> : null}
      </span>
      {/* The minute countdown is visual only, so screen readers aren't told every minute. */}
      <span className="wl-expiry__left" aria-hidden="true">
        {step === "deleted" ? "Deleted" : `${formatCountdown(left)} left`}
      </span>
    </div>
  );
}
