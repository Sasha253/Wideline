import { cx } from "./cx";

/**
 * Logo sizes, from the Floodlight design files:
 * - `l` (default): 46 by 22 mark, 17px wordmark, 12px gap. Page and document headers,
 *   sign-in, consent, print.
 * - `m`: 34 by 16 mark, 14px wordmark, 10px gap. The app sidebar.
 * - `s`: 30 by 14 mark. The tablet rail (mark only, use LogoMark).
 */
export type LogoSize = "l" | "m" | "s";

// Each size keeps the design's stroke and inset, so the outline stays crisp at that size.
const MARK: Record<LogoSize, { width: number; height: number; stroke: number; inset: number }> = {
  l: { width: 46, height: 22, stroke: 1.5, inset: 0.75 },
  m: { width: 34, height: 16, stroke: 2, inset: 1 },
  s: { width: 30, height: 14, stroke: 2.2, inset: 1.1 },
};

/**
 * The Wideline mark, "The wide channel": a pitch outline seen from above, with the halfway
 * line and centre circle, and the near touchline as a solid lime bar (4px under an 18px
 * pitch), where scouts look for the player others miss. The lines take `currentColor`, so
 * the mark follows the surrounding ink; the bar is always brand lime.
 */
export function LogoMark({ className, size = "l" }: { className?: string; size?: LogoSize }) {
  const m = MARK[size];
  const i = m.inset;
  return (
    <svg
      width={m.width}
      height={m.height}
      viewBox="0 0 46 22"
      className={cx("wl-logo__mark", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={m.stroke}
      aria-hidden="true"
      focusable="false"
    >
      <rect x={i} y={i} width={46 - 2 * i} height={18 - 2 * i} />
      <line x1="23" y1={size === "l" ? i : 1} x2="23" y2={size === "l" ? 18 - i : 17} />
      <circle cx="23" cy="9" r="3.6" />
      <rect x="0" y="18" width="46" height="4" stroke="none" className="wl-logo__bar" />
    </svg>
  );
}

/**
 * The mark beside the WIDELINE wordmark (Archivo 800, 125% width, tracked 0.1em). The text
 * stays "Wideline" in the DOM (CSS sets the caps), so a link around it is named "Wideline".
 */
export function Logo({ className, size = "l" }: { className?: string; size?: LogoSize }) {
  return (
    <span className={cx("wl-logo", `wl-logo--${size}`, className)}>
      <LogoMark size={size} />
      <span className="wl-logo__word">Wideline</span>
    </span>
  );
}
