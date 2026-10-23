import { TeamMarker, type Side } from "./TeamMarker";

// A 105 × 68 m pitch, drawn with a 4-unit turf margin.
const PITCH_W = 105;
const PITCH_H = 68;
const VIEW_BOX = "-4 -4 113 76";

/** Heat bucket 1 to 5 for a zone share, relative to the busiest zone. 0 means no rect. */
export function heatLevel(share: number, max: number): number {
  if (share <= 0 || max <= 0) return 0;
  // The epsilon keeps float noise (0.06 / 0.1 * 5 = 3.0000000000000004) in its bucket.
  return Math.min(5, Math.max(1, Math.ceil((share / max) * 5 - 1e-9)));
}

function matchCount(matches: number) {
  return matches === 1 ? "1 match" : `${matches} matches`;
}

/** Chalk markings exactly as in PitchHeatmap/preview.html. */
function Markings() {
  return (
    <>
      <rect className="chalk" x="0" y="0" width="105" height="68" />
      <line className="chalk" x1="52.5" y1="0" x2="52.5" y2="68" />
      <circle className="chalk" cx="52.5" cy="34" r="9.15" />
      <rect className="chalk" x="0" y="13.84" width="16.5" height="40.32" />
      <rect className="chalk" x="88.5" y="13.84" width="16.5" height="40.32" />
      <rect className="chalk" x="0" y="24.84" width="5.5" height="18.32" />
      <rect className="chalk" x="99.5" y="24.84" width="5.5" height="18.32" />
    </>
  );
}

function Turf() {
  return <rect className="turf" x="-4" y="-4" width="113" height="76" rx="2" />;
}

function NoData() {
  return <p className="caption mt-2 text-ink-muted">No position data yet.</p>;
}

/**
 * Where a player spent time, on a 105 × 68 m pitch. Always attacks left to
 * right, always with a legend, and the aria-label describes the main pattern
 * in words.
 */
export function PitchHeatmap({
  zones,
  label,
  matches,
}: {
  /** Zone shares by row then column; a 4 × 6 grid by default. */
  zones: number[][];
  /** The main pattern in words, used as the aria-label. */
  label: string;
  matches: number;
}) {
  const max = Math.max(0, ...zones.flat());
  const empty = max <= 0 || matches <= 0;
  const rows = zones.length;

  return (
    <div>
      <svg
        className="wl-pitch"
        viewBox={VIEW_BOX}
        role="img"
        aria-label={empty ? "Pitch: no position data yet" : label}
      >
        <Turf />
        {!empty &&
          zones.flatMap((row, r) => {
            const w = PITCH_W / row.length;
            const h = PITCH_H / rows;
            return row.map((share, c) => {
              const level = heatLevel(share, max);
              if (level === 0) return null;
              return (
                <rect
                  key={`${r}-${c}`}
                  className={`h${level}`}
                  x={c * w}
                  y={r * h}
                  width={w}
                  height={h}
                  opacity=".85"
                />
              );
            });
          })}
        <Markings />
      </svg>
      {empty ? (
        <NoData />
      ) : (
        <div className="wl-legend">
          Less time{" "}
          {[1, 2, 3, 4, 5].map((n) => (
            <i key={n} aria-hidden="true" style={{ background: `var(--heat-${n})` }} />
          ))}{" "}
          More time · attacking left to right{" "}
          {matches < 3 ? (
            <span className="text-warning">· Small sample · {matchCount(matches)}</span>
          ) : (
            `· ${matchCount(matches)}`
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
 * The average-position variant: one dot per player on the same pitch, home a
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
    <div>
      <svg
        className="wl-pitch"
        viewBox={VIEW_BOX}
        role="img"
        aria-label={empty ? "Pitch: no position data yet" : label}
      >
        <Turf />
        <Markings />
        {!empty &&
          players.map((p) => (
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
      {empty ? (
        <NoData />
      ) : (
        <>
          <div className="wl-row mt-2 gap-6">
            <TeamMarker side="home" name={home} />
            <TeamMarker side="away" name={away} />
          </div>
          <p className="caption mt-2 text-ink-muted">
            Attacking left to right ·{" "}
            {matches < 3 ? (
              <span className="text-warning">Small sample · {matchCount(matches)}</span>
            ) : (
              matchCount(matches)
            )}
          </p>
        </>
      )}
    </div>
  );
}
