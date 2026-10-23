import type { ReactNode } from "react";

/**
 * There is nothing here yet, and what makes something appear (docs/build/design/D02.md,
 * Surface 6). `headingLevel={1}` is for full-page states such as "Page not found".
 */
export function EmptyState({
  title,
  body,
  action,
  art = true,
  headingLevel = 2,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  art?: boolean;
  headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div className="wl-empty">
      {art && <PitchArt />}
      <Heading className={headingLevel === 1 ? "heading-1" : "heading-2"}>{title}</Heading>
      {body && <p className="body-lg text-ink-muted">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Chalk lines on turf: outline, halfway line, centre circle, both penalty boxes. Decorative. */
function PitchArt() {
  return (
    <svg className="wl-empty__art" viewBox="0 0 160 104" aria-hidden="true" focusable="false">
      <rect className="turf" x="0" y="0" width="160" height="104" />
      <rect className="chalk" x="8" y="8" width="144" height="88" />
      <line className="chalk" x1="80" y1="8" x2="80" y2="96" />
      <circle className="chalk" cx="80" cy="52" r="13" />
      <rect className="chalk" x="8" y="30" width="22" height="44" />
      <rect className="chalk" x="130" y="30" width="22" height="44" />
    </svg>
  );
}
