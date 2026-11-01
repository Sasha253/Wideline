import { cx } from "@/components/ui/cx";
import { TeamMarker } from "@/components/ui/TeamMarker";
import type { ReviewSide } from "@/lib/review-workspace";

/**
 * A who-label with its side (docs/build/design/C11.md, "Side"): a TeamMarker,
 * or, with no side set, the label and "· side not set" in ink-muted with a
 * screen-reader prefix, so colour never carries the side alone (NFR27).
 */
export function WhoLabel({
  side,
  text,
  truncate = false,
  className,
}: {
  side: ReviewSide | null;
  text: string;
  truncate?: boolean;
  className?: string;
}) {
  if (side) return <TeamMarker side={side} name={text} truncate={truncate} className={className} />;
  return (
    <span className={cx(truncate && "min-w-0 truncate", className)}>
      <span className="sr-only">Side not set: </span>
      {text}
      <span className="text-ink-muted"> · side not set</span>
    </span>
  );
}
