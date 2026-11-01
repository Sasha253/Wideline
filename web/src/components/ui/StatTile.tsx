import { CircleAlert, Play } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";
import { iconProps } from "./icons";

/** "1 match", "8 matches". */
export function matchCount(matches: number): string {
  return matches === 1 ? "1 match" : `${matches} matches`;
}

/**
 * One verified figure, its rate per 90, and the sample it comes from (Floodlight, "Stat
 * tile"). The whole tile is a link to the clips behind the number (`clipHref`).
 *
 * - The 3px top edge is solid ink when the sample holds, and dashed pending with a "Small
 *   sample" flag under 3 matches. The value still shows.
 * - No sample: "Not recorded yet" plus `reason` (why). Never show a 0 that wasn't measured.
 *   Without a `reason`, a tile with no matches renders nothing (the old behaviour).
 * - Never colour the value by whether it is "good", and never animate it.
 * - `loading`: static blocks the size of the real tile, no shimmer.
 */
export function StatTile({
  label,
  value,
  unit,
  rate,
  sample,
  matches,
  minutes,
  clipHref,
  href,
  linkLabel,
  reason,
  loading = false,
  className,
}: {
  label: string;
  value?: string | number | null;
  /** "km", "min" or "%". Shown beside the figure in mono. */
  unit?: string;
  /** The rate line, units included: "2.06 per 90", "9.1 km per 90". */
  rate?: string;
  /** Overrides the sample line; by default "based on 8 matches". */
  sample?: string;
  matches: number;
  /**
   * @deprecated Minutes played. Only used to build the default sample line
   * ("based on 8 matches · 612 min"); pass `sample` instead.
   */
  minutes?: number;
  /** The clips (or match log) behind the number. The whole tile becomes the link. */
  clipHref?: string;
  /** @deprecated Use `clipHref`. */
  href?: string;
  /** The words of the link line: "14 clips", "Match log". Defaults to "Clips". */
  linkLabel?: string;
  /** Why there is no figure: "Distance needs a full-pitch camera angle. …". */
  reason?: ReactNode;
  loading?: boolean;
  className?: string;
}) {
  const link = clipHref ?? href;

  if (loading) {
    return (
      <div
        className={cx("wl-stat wl-stat--quiet", className)}
        role="status"
        aria-busy="true"
        aria-label={`Loading ${label}`}
      >
        <span className="wl-stat__label">{label}</span>
        <span aria-hidden="true" className="wl-block h-7.5 w-[64%]" />
        <span aria-hidden="true" className="wl-stat__skel">
          <span className="wl-block h-2.5 w-[80%]" />
          <span className="wl-block h-2.5 w-[56%]" />
        </span>
        <span aria-hidden="true" className="wl-block mt-auto h-2.5 w-[40%]" />
      </div>
    );
  }

  const recorded = matches > 0 && value !== null && value !== undefined && value !== "";
  if (!recorded) {
    if (reason === undefined) return null;
    return (
      <div className={cx("wl-stat wl-stat--quiet", className)}>
        <span className="wl-stat__label">{label}</span>
        <span className="wl-stat__none">Not recorded yet</span>
        <span className="wl-stat__reason">{reason}</span>
      </div>
    );
  }

  const small = matches < 3;
  const sampleLine =
    sample ??
    `based on ${matchCount(matches)}${minutes !== undefined && !rate ? ` · ${minutes} min` : ""}`;

  const content = (
    <>
      <span className="wl-stat__label">{label}</span>
      <span className="wl-stat__figure">
        <span className="wl-stat__value">{value}</span>
        {unit && <span className="wl-stat__unit">{unit}</span>}
      </span>
      <span className="wl-stat__rates">
        {rate && <span>{rate}</span>}
        <span className="wl-stat__sample">{sampleLine}</span>
        {small && (
          <span className="wl-flag">
            <CircleAlert {...iconProps} />
            Small sample
          </span>
        )}
      </span>
      {link && (
        <span className="wl-stat__link">
          <Play {...iconProps} />
          {linkLabel ?? "Clips"}
        </span>
      )}
    </>
  );

  const classes = cx("wl-stat", small && "wl-stat--small", className);
  if (link) {
    return (
      <Link href={link} className={classes}>
        {content}
      </Link>
    );
  }
  return <div className={classes}>{content}</div>;
}

/**
 * Tiles edge to edge in one panel (Floodlight player profile): up to 6 across from 768px,
 * 2 across on phones. Pass StatTiles as children.
 */
export function StatStrip({
  children,
  columns = 6,
  label,
  className,
}: {
  children: ReactNode;
  /** Columns from 768px; 2 below. */
  columns?: 2 | 3 | 4 | 5 | 6;
  /** An accessible name for the group ("Season stats"). */
  label?: string;
  className?: string;
}) {
  return (
    <div
      role={label ? "group" : undefined}
      aria-label={label}
      className={cx("wl-stat-strip", className)}
      style={{ "--wl-strip-cols": columns } as CSSProperties}
    >
      {children}
    </div>
  );
}
