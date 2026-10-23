import Link from "next/link";
import { cx } from "./cx";

/**
 * A headline stat on a profile or squad dashboard. The whole tile links to the
 * events and clips behind it (href).
 *
 * - Always states the sample. Under 3 matches it adds the small-sample flag;
 *   the value still shows.
 * - Never colour the value by whether it is "good", and never animate it.
 * - A stat with no traceable events is never shown: 0 matches renders nothing.
 */
export function StatTile({
  label,
  value,
  unit,
  matches,
  minutes,
  href,
}: {
  label: string;
  value: string | number;
  unit?: string;
  matches: number;
  /** Minutes played, for per-90 rates. */
  minutes?: number;
  href?: string;
}) {
  if (matches <= 0) return null;

  const small = matches < 3;
  const plural = matches === 1 ? "1 match" : `${matches} matches`;
  const sample = small
    ? `Small sample · ${plural}`
    : `Based on ${plural}${minutes !== undefined ? ` · ${minutes} min` : ""}`;

  const content = (
    <>
      <span className="wl-stat__label">{label}</span>
      {/* A unit that does not fit beside the number wraps under it, as a whole. */}
      <span
        className={cx("wl-stat__value flex flex-wrap items-baseline", unit !== "%" && "gap-x-1")}
      >
        {value}
        {unit && <span className="wl-stat__unit ml-0 whitespace-nowrap">{unit}</span>}
      </span>
      <span className={cx("wl-stat__sample", small && "wl-stat__sample--small")}>{sample}</span>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="wl-card wl-stat text-ink no-underline transition-colors duration-150 ease-out hover:border-line-strong"
      >
        {content}
      </Link>
    );
  }
  return <div className="wl-card wl-stat">{content}</div>;
}
