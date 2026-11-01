import { CircleAlert, Inbox, LoaderCircle, Lock, WifiOff, type LucideIcon } from "lucide-react";
import { useId, type ReactNode, type Ref } from "react";
import { StillLoading } from "@/components/states/StillLoading";
import { cx } from "./cx";
import { iconProps } from "./icons";

export type StateKind = "empty" | "loading" | "error" | "forbidden" | "offline";

const ICON: Record<StateKind, LucideIcon> = {
  empty: Inbox,
  loading: LoaderCircle,
  error: CircleAlert,
  forbidden: Lock,
  offline: WifiOff,
};

/** The pitch-line mark: outline, halfway line and centre circle, with the near touchline as a bar. */
function Mark({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="wl-state__mark" aria-hidden="true">
      <svg
        width="120"
        height="72"
        viewBox="0 0 120 72"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        focusable="false"
      >
        <rect x="1" y="1" width="118" height="66" />
        <line x1="60" y1="1" x2="60" y2="67" />
        <circle cx="60" cy="34" r="16" />
      </svg>
      <span className="wl-state__bar" />
      <span className="wl-state__icon">
        <Icon {...iconProps} />
      </span>
    </span>
  );
}

const SKELETON_WIDTHS = ["62%", "48%", "70%", "55%", "40%"];

/**
 * One structure for empty, loading, error, forbidden and offline (Floodlight, "Empty,
 * loading, error, forbidden"): a pitch-line mark, a title that says what happened, one
 * sentence on what to do, and at most one primary action (`action`; `secondary` is a
 * secondary button). Errors show a reference code (`code`). Render it inside the page,
 * under the page header, so the user never loses their place.
 *
 * - `kind="loading"`: static rows the shape of a table, `role="status"`, and after 8 s
 *   "Still loading. This can take a moment on mobile data." `title` is the screen reader
 *   text ("Loading squad").
 * - `kind="error"`: `role="alert"`.
 * - The bar under the mark: lime for empty, rejected for error, ink for forbidden, pending
 *   for offline.
 */
export function StateMessage({
  kind,
  title,
  body,
  action,
  secondary,
  code,
  icon,
  headingLevel = 2,
  headingRef,
  rows = 5,
  className,
}: {
  kind: StateKind;
  title: string;
  /** One sentence. */
  body?: ReactNode;
  /** The one primary action (a Button or ButtonLink). Error states use a secondary button here. */
  action?: ReactNode;
  secondary?: ReactNode;
  /** "Error 503 · reference 7F2K-91", "403 · signed in as club admin". */
  code?: ReactNode;
  /** Overrides the kind's icon (Users for an empty squad). */
  icon?: LucideIcon;
  headingLevel?: 1 | 2 | 3;
  /** For states that move focus to their heading (ErrorState). */
  headingRef?: Ref<HTMLHeadingElement>;
  /** Loading only: how many placeholder rows. */
  rows?: number;
  className?: string;
}) {
  const id = useId();

  if (kind === "loading") {
    return (
      <div role="status" aria-busy="true" className={cx("wl-loading", className)}>
        <span className="sr-only">{title}</span>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="wl-loading__row" aria-hidden="true">
            <span className="wl-block size-7" />
            <span
              className="wl-block h-2.75"
              style={{ width: SKELETON_WIDTHS[i % SKELETON_WIDTHS.length] }}
            />
            <span className="wl-block h-4.5 w-20" />
            <span className="wl-block h-2.75 w-9 justify-self-end" />
          </div>
        ))}
        <StillLoading />
      </div>
    );
  }

  const Heading = headingLevel === 1 ? "h1" : headingLevel === 3 ? "h3" : "h2";
  return (
    <section
      role={kind === "error" ? "alert" : undefined}
      aria-labelledby={id}
      className={cx("wl-state", `wl-state--${kind}`, className)}
    >
      <Mark icon={icon ?? ICON[kind]} />
      <Heading
        id={id}
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className="wl-state__title"
      >
        {title}
      </Heading>
      {body && <p className="wl-state__body">{body}</p>}
      {(action || secondary) && (
        <div className="wl-state__actions">
          {action}
          {secondary}
        </div>
      )}
      {code && <p className="wl-state__code m-0">{code}</p>}
    </section>
  );
}
