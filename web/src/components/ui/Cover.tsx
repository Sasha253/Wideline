/**
 * The brand cover: the Wideline wordmark and tagline over pitch geometry.
 * Built from Cover/preview.html (the component has no README). The art is
 * decorative, hidden from screen readers, and shows from 1024px.
 */
export function Cover({
  title = "Wideline",
  tagline = "Every match filmed. Every player findable.",
  titleAs: Title = "h1",
}: {
  title?: string;
  tagline?: string;
  /** Use "p" when the page already has its own h1. */
  titleAs?: "h1" | "h2" | "p";
}) {
  return (
    <div className="wl-cover">
      <div className="wl-cover__art" aria-hidden="true">
        {/* Geometry copied unchanged from preview.html. Corners come from .blk and .sm. */}
        <svg viewBox="0 0 480 288" width="480" height="288" focusable="false">
          <rect className="turf blk" x="16" y="-16" width="288" height="288" rx="16" />
          <line className="chalk" x1="160" y1="-16" x2="160" y2="272" />
          <circle className="chalk" cx="160" cy="128" r="48" />
          <circle className="spot" cx="160" cy="128" r="3" />
          <rect className="chalk" x="16" y="64" width="64" height="128" />
          <rect className="chalk" x="240" y="64" width="64" height="128" />
          <rect className="pitch blk" x="320" y="128" width="144" height="144" rx="16" />
          <rect className="flood blk" x="320" y="64" width="112" height="48" rx="16" />
          <rect className="deep blk" x="352" y="-16" width="144" height="64" rx="16" />
          <rect className="home sm" x="336" y="240" width="48" height="16" rx="4" />
        </svg>
      </div>
      <div className="wl-cover__words">
        <Title className="wl-cover__name display-xl">{title}</Title>
        <p className="wl-cover__tag body">{tagline}</p>
      </div>
    </div>
  );
}
