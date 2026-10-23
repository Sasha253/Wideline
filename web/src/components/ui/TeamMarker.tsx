import { cx } from "./cx";

export type Side = "home" | "away";

/**
 * Marks the home or away side with shape and letter as well as colour (NFR27):
 * home is a solid square with H, away an outlined square with A. The UI never
 * uses real kit colours.
 *
 * The name can be a team or a player ("Home side: #7 Thabo Nkosi").
 */
export function TeamMarker({
  side,
  name,
  truncate = false,
  className,
}: {
  side: Side;
  name: string;
  /** Truncate the name with an ellipsis when the parent limits the width. */
  truncate?: boolean;
  className?: string;
}) {
  return (
    <span className={cx("wl-team", `wl-team--${side}`, truncate && "min-w-0", className)}>
      <span className="wl-team__mark" aria-hidden="true">
        {side === "home" ? "H" : "A"}
      </span>
      <span className={cx(truncate && "min-w-0 truncate")}>
        <span className="sr-only">{side === "home" ? "Home side: " : "Away side: "}</span>
        {name}
      </span>
    </span>
  );
}
