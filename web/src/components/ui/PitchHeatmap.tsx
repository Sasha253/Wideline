import { CircleAlert } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";
import { iconProps } from "./icons";
import { TeamMarker, type Side } from "./TeamMarker";

/**
 * @deprecated Relative buckets (share against the busiest zone). Floodlight uses the fixed
 * ramp in `heatStep`, so two heatmaps compare directly.
 */
export function heatLevel(share: number, max: number): number {
  if (share <= 0 || max <= 0) return 0;
  // The epsilon keeps float noise (0.06 / 0.1 * 5 = 3.0000000000000004) in its bucket.
  return Math.min(5, Math.max(1, Math.ceil((share / max) * 5 - 1e-9)));
}

/**
 * The fixed heat ramp: a zone's share of the player's minutes (0 to 1) to heat-1…5.
 * Under 2% is 1, 2 to 4% is 2, 4 to 6% is 3, 6 to 8% is 4, 8% and over is 5. 0 is empty.
 */
export function heatStep(share: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (!(share > 0)) return 0;
  // The epsilon keeps 0.06 (a float a hair under) in its own bucket.
  const pct = share * 100 + 1e-9;
  if (pct < 2) return 1;
  if (pct < 4) return 2;
  if (pct < 6) return 3;
  if (pct < 8) return 4;
  return 5;
}

/** The ramp's legend rows, for a key beside the heatmap. */
export const HEAT_RAMP = [
  { token: "heat-1", range: "under 2% of minutes" },
  { token: "heat-2", range: "2 to 4%" },
  { token: "heat-3", range: "4 to 6%" },
  { token: "heat-4", range: "6 to 8%" },
  { token: "heat-5", range: "8% and over" },
] as const;

function matchCount(matches: number) {
  return matches === 1 ? "1 match" : `${matches} matches`;
}

/** Chalk lines on a 105 × 68 m pitch, drawn over the zones. `detail` adds the 6-yard boxes and arcs. */
export function PitchLines({
  detail = true,
  strokeWidth = 0.35,
}: {
  detail?: boolean;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 105 68"
      preserveAspectRatio="none"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      aria-hidden="true"
      focusable="false"
    >
      <rect x=".5" y=".5" width="104" height="67" />
      <line x1="52.5" y1=".5" x2="52.5" y2="67.5" />
      <circle cx="52.5" cy="34" r="9.15" />
      <rect x=".5" y="13.85" width="16.5" height="40.3" />
      <rect x="88" y="13.85" width="16.5" height="40.3" />
      {detail && (
        <>
          <rect x=".5" y="24.85" width="5.5" height="18.3" />
          <rect x="99" y="24.85" width="5.5" height="18.3" />
          <path d="M17 26.69A9.15 9.15 0 0 1 17 41.31" />
          <path d="M88 26.69A9.15 9.15 0 0 0 88 41.31" />
        </>
      )}
    </svg>
  );
}

/**
 * The graphite pitch box, the same in both themes: it carries `data-theme="dark"`, so text
 * on it reads the dark ink in either theme.
 */
export function PitchBox({
  children,
  className,
  ...rest
}: {
  children?: ReactNode;
  className?: string;
  role?: string;
  "aria-label"?: string;
}) {
  return (
    <div data-theme="dark" className={cx("wl-pitchbox", className)} {...rest}>
      {children}
    </div>
  );
}

export type HeatHalf = "full" | "first" | "second";
const HALVES: { value: HeatHalf; label: string }[] = [
  { value: "full", label: "Full match" },
  { value: "first", label: "1st half" },
  { value: "second", label: "2nd half" },
];

/**
 * Where a player spent their minutes (Floodlight, "Pitch heatmap"): 16 × 10 zones as CSS grid
 * cells on a graphite pitch, chalk lines in SVG on top, attack left to right.
 *
 * - The five steps are fixed shares of minutes (`heatStep`), not relative to the player.
 * - The legend and the sample are always shown. Under 3 matches the pitch gets a dashed
 *   pending outline and the "Small sample" line.
 * - No minutes: "No tracked minutes yet".
 * - `role="img"` with `label` as the text alternative: the main pattern in words.
 */
export function PitchHeatmap({
  zones,
  label,
  matches,
  minutes,
  sample,
  title,
  half,
  halfHref,
  className,
}: {
  /** Shares of minutes (0 to 1) by row (top touchline first) then column (own goal first): 10 × 16. */
  zones: number[][];
  /** The text alternative: "Heatmap for Sipho Ndlovu. Most time in central midfield, …". */
  label: string;
  matches: number;
  minutes?: number;
  /** Overrides the sample line ("8 matches · 612 min"). */
  sample?: string;
  /** A heading above the pitch ("Heatmap"). */
  title?: string;
  /** Which part of the match the zones cover. */
  half?: HeatHalf;
  /** Links for the Full match / 1st half / 2nd half filter. Without it, no filter. */
  halfHref?: (half: HeatHalf) => string;
  className?: string;
}) {
  const rows = zones.length;
  const cols = Math.max(0, ...zones.map((r) => r.length));
  const empty = matches <= 0 || !zones.some((r) => r.some((v) => v > 0));
  const small = !empty && matches < 3;
  const sampleText =
    sample ?? `${matchCount(matches)}${minutes !== undefined ? ` · ${minutes} min` : ""}`;

  return (
    <div className={cx("wl-heatmap", className)}>
      {(title || halfHref) && (
        <div className="wl-heatmap__head">
          {title && <h3 className="wl-heatmap__title">{title}</h3>}
          {halfHref && (
            <nav aria-label="Part of the match" className="wl-halves">
              {HALVES.map((h) => (
                <Link
                  key={h.value}
                  href={halfHref(h.value)}
                  aria-current={(half ?? "full") === h.value ? "true" : undefined}
                >
                  {h.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
      )}
      <PitchBox
        role="img"
        aria-label={empty ? "Pitch: no tracked minutes yet" : label}
        className={cx(small && "wl-pitchbox--small", empty && "wl-pitchbox--empty")}
      >
        {!empty && (
          <div
            className="wl-heat"
            aria-hidden="true"
            style={{ "--wl-heat-cols": cols, "--wl-heat-rows": rows } as CSSProperties}
          >
            {zones.flatMap((row, r) =>
              Array.from({ length: cols }, (_, c) => {
                const step = heatStep(row[c] ?? 0);
                return <i key={`${r}-${c}`} data-h={step || undefined} />;
              }),
            )}
          </div>
        )}
        <PitchLines detail={!small && !empty} strokeWidth={small || empty ? 0.5 : 0.35} />
        {empty ? (
          <span className="wl-pitchbox__none" aria-hidden="true">
            <b>No tracked minutes yet</b>
            <span>Appears after this player&apos;s first reviewed match.</span>
          </span>
        ) : (
          <span className="wl-pitchbox__attack" aria-hidden="true">
            ATTACK →
          </span>
        )}
      </PitchBox>
      {!empty && (
        <div className="wl-heatlegend">
          <span className="wl-heatlegend__ramp">
            <span>Share of minutes</span>
            <span className="wl-ramp" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <span>under 2%</span>
            <span aria-hidden="true">→</span>
            <span className="sr-only">to</span>
            <span>8% and over</span>
          </span>
          {small ? (
            <span className="wl-heatmap__small">
              <CircleAlert {...iconProps} />
              Small sample · based on {sampleText}
            </span>
          ) : (
            <span>{sampleText}</span>
          )}
        </div>
      )}
    </div>
  );
}

export type PlayerPosition = {
  /** Metres from the left goal line, 0 to 105. */
  x: number;
  /** Metres from the top touchline, 0 to 68. */
  y: number;
  side: Side;
  /** Shirt number, shown after the side letter ("H7"). */
  label: string;
};

/**
 * The average-position variant: one dot per player on the same graphite pitch, home a
 * solid dot and away an outlined one, each with its side letter.
 */
export function AveragePositionMap({
  players,
  label,
  matches,
  home,
  away,
}: {
  players: PlayerPosition[];
  label: string;
  matches: number;
  /** Team names for the key under the pitch. */
  home: string;
  away: string;
}) {
  const empty = players.length === 0 || matches <= 0;
  return (
    <div className="wl-heatmap">
      <PitchBox role="img" aria-label={empty ? "Pitch: no position data yet" : label}>
        <PitchLines />
        {!empty && (
          <svg viewBox="0 0 105 68" preserveAspectRatio="none" aria-hidden="true">
            {players.map((p) => (
              <g key={`${p.side}-${p.label}`}>
                <circle
                  className={p.side === "home" ? "dot-home" : "dot-away"}
                  cx={p.x}
                  cy={p.y}
                  r="1.4"
                />
                <text className="dot-label" x={p.x + 2} y={p.y + 1.1}>
                  {`${p.side === "home" ? "H" : "A"}${p.label}`}
                </text>
              </g>
            ))}
          </svg>
        )}
        {empty ? (
          <span className="wl-pitchbox__none" aria-hidden="true">
            <b>No position data yet</b>
          </span>
        ) : (
          <span className="wl-pitchbox__attack" aria-hidden="true">
            ATTACK →
          </span>
        )}
      </PitchBox>
      {!empty && (
        <div className="wl-heatlegend">
          <span className="wl-heatlegend__ramp gap-6">
            <TeamMarker side="home" name={home} />
            <TeamMarker side="away" name={away} />
          </span>
          {matches < 3 ? (
            <span className="wl-heatmap__small">
              <CircleAlert {...iconProps} />
              Small sample · based on {matchCount(matches)}
            </span>
          ) : (
            <span>{matchCount(matches)}</span>
          )}
        </div>
      )}
    </div>
  );
}
