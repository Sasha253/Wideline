import { cx } from "./cx";

/**
 * The Wideline mark, design 1b "The wide channel": a pitch seen from above with
 * the near touchline lit in `pitch`, where scouts look for the player others
 * miss. Lines take `currentColor`, so the mark follows the surrounding text.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 24"
      className={cx("wl-logo__mark", className)}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth="1.75">
        <path d="M3 18.5V3h26v15.5" strokeLinejoin="round" />
        <path d="M16 3v15.5" />
        <circle cx="16" cy="11" r="3.5" />
      </g>
      <rect x="1.5" y="18.5" width="29" height="3.5" rx="1" fill="var(--pitch)" />
    </svg>
  );
}

/**
 * The mark beside the tracked uppercase wordmark. The text stays "Wideline" in
 * the DOM (CSS sets the case), so links and headings keep that accessible name.
 * In the tablet rail only the mark shows.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("wl-logo", className)}>
      <LogoMark />
      <span className="wl-logo__word">Wideline</span>
    </span>
  );
}
