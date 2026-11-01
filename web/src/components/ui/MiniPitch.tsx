import type { CSSProperties } from "react";
import { cx } from "./cx";
import { PitchBox, PitchLines } from "./PitchHeatmap";

/** A spot on the pitch, in metres: x from the own goal line (0 to 105), y from the top touchline (0 to 68). */
export type PitchSpot = { x: number; y: number; label: string };

const at = (s: PitchSpot): CSSProperties => ({
  left: `${(Math.min(105, Math.max(0, s.x)) / 105) * 100}%`,
  top: `${(Math.min(68, Math.max(0, s.y)) / 68) * 100}%`,
});

/**
 * Where a player usually plays (Floodlight, "Position mini pitch"): a lime diamond for the
 * usual position, outlined diamonds for the others, on a 168px graphite pitch. Lime is the
 * usual-position marker, one of its few allowed uses. The key beside it says the same in
 * words ("Usual position · CM", "Also played · DM, AM"), so the image is decorative.
 */
export function MiniPitch({
  usual,
  also = [],
  legend = true,
  className,
}: {
  usual: PitchSpot;
  also?: PitchSpot[];
  /** The key beside the pitch. Without it the pitch gets a text alternative instead. */
  legend?: boolean;
  className?: string;
}) {
  const words = `Usual position · ${usual.label}`;
  const alsoWords = also.length ? `Also played · ${also.map((a) => a.label).join(", ")}` : "";
  return (
    <div className={cx("wl-minipitch", className)}>
      <PitchBox
        role={legend ? undefined : "img"}
        aria-label={legend ? undefined : [words, alsoWords].filter(Boolean).join(". ")}
      >
        <PitchLines detail={false} strokeWidth={1.2} />
        {also.map((a) => (
          <span
            key={`${a.label}-${a.x}-${a.y}`}
            className="wl-diamond wl-diamond--also"
            style={at(a)}
            aria-hidden="true"
          />
        ))}
        <span className="wl-diamond wl-diamond--usual" style={at(usual)} aria-hidden="true" />
      </PitchBox>
      {legend && (
        <div className="wl-minipitch__key">
          <span>
            <i aria-hidden="true" />
            {words}
          </span>
          {alsoWords && (
            <span>
              <i className="also" aria-hidden="true" />
              {alsoWords}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
