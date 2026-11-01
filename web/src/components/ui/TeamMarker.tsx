import { cx } from "./cx";

export type Side = "home" | "away";

/** 20px by default, 16px inline in body text, 24px, 32px in lineup headers. */
export type TeamMarkerSize = 16 | 20 | 24 | 32;

/**
 * A square with H or A in expanded 800 capitals (Floodlight, "TeamMarker"). Home and
 * away colours are fixed by the UI and have nothing to do with kit colours, so the
 * letter always goes with the colour. Never put a club crest or kit swatch in its place.
 *
 * Put it before every team name in match context, every event row and every detection
 * label. With `name` it renders the marker plus the name ("Home side: " for screen
 * readers); without, the bare marker with "Home side" / "Away side" as its name.
 */
export function TeamMarker({
  side,
  name,
  size = 20,
  truncate = false,
  className,
}: {
  /** "home" / "away", or the letters "H" / "A". */
  side: Side | "H" | "A";
  name?: string;
  size?: TeamMarkerSize;
  /** Truncate the name with an ellipsis when the parent limits the width. */
  truncate?: boolean;
  className?: string;
}) {
  const s: Side = side === "home" || side === "H" ? "home" : "away";
  const letter = s === "home" ? "H" : "A";
  const words = s === "home" ? "Home side" : "Away side";
  const mark = cx("wl-team__mark", size !== 20 && `wl-team__mark--${size}`);
  if (name === undefined) {
    return (
      <span
        role="img"
        aria-label={words}
        title={words}
        className={cx("wl-team", `wl-team--${s}`, className)}
      >
        <span className={mark} aria-hidden="true">
          {letter}
        </span>
      </span>
    );
  }
  return (
    <span className={cx("wl-team", `wl-team--${s}`, truncate && "min-w-0", className)}>
      <span className={mark} aria-hidden="true">
        {letter}
      </span>
      <span className={cx(truncate && "min-w-0 truncate")}>
        <span className="sr-only">{words}: </span>
        {name}
      </span>
    </span>
  );
}
