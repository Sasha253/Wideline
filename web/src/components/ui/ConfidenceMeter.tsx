import { cx } from "./cx";

/**
 * The model's confidence in a detected event, as a pill meter plus the number.
 * `pitch` at or above the auto-accept threshold, `warning` below it.
 *
 * Use in review rows, event detail panels and admin job views. Never use it on
 * public profiles: published stats are verified, so confidence is not relevant.
 */
export function ConfidenceMeter({
  score,
  threshold,
  detail = false,
}: {
  /** 0 to 1. Clamped before display. */
  score: number;
  /** Auto-accept threshold for the event type, e.g. 0.75 for a shot. */
  threshold: number;
  /** Detail views add the visible words "below threshold" when low. */
  detail?: boolean;
}) {
  const value = Math.min(1, Math.max(0, score));
  const low = value < threshold;
  return (
    <span className={cx("wl-conf", low && "wl-conf--low")}>
      <span className="wl-conf__track" aria-hidden="true">
        <span className="wl-conf__fill" style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span>
        <span className="sr-only">Confidence </span>
        {value.toFixed(2)}
        {low && detail && <span className="caption whitespace-nowrap"> below threshold</span>}
        {/* Without detail, screen-reader users still get the low state in words. */}
        {low && !detail && <span className="sr-only">, under auto-accept threshold</span>}
      </span>
    </span>
  );
}
