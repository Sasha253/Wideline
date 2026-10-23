import { Clock, TriangleAlert } from "lucide-react";
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
