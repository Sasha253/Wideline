import { Check, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";
import { iconProps } from "./icons";

export type StepState = "done" | "current" | "waiting" | "busy";
export type StepItem = {
  label: string;
  /** The line under the label: "Name and ID number", "Uploading · 62%". */
  sub?: ReactNode;
  /** Overrides the state worked out from `current`. "busy" is a step still running in the background (the upload). */
  state?: StepState;
};

const STATE_WORDS: Record<StepState, string> = {
  done: "done",
  current: "current step",
  waiting: "not started",
  busy: "in progress",
};

function resolve(steps: (string | StepItem)[], current: number) {
  return steps.map((s, i) => {
    const item = typeof s === "string" ? { label: s } : s;
    const state: StepState =
      item.state ?? (i + 1 < current ? "done" : i + 1 === current ? "current" : "waiting");
    return { ...item, state, n: i + 1 };
  });
}

/**
 * Where you are in a multi-step task (Floodlight, "StepHeader"): numbered discs, confirmed
 * with a check when done, ink when current, outlined when waiting; a busy step shows a
 * loader. The current step has a 2px ink underline (`layout="row"`, the upload steps) or
 * inset (`layout="column"`, the registration sidebar), and `aria-current="step"`.
 *
 * On phones (`compact="auto"`, below 768px) it becomes "1 of 4 · Identity" plus bars.
 * `compact="always"` shows only that; `"never"` only the discs.
 */
export function StepHeader({
  steps,
  current,
  layout = "row",
  compact = "auto",
  label = "Steps",
  className,
}: {
  steps: (string | StepItem)[];
  /** The current step, counted from 1. */
  current: number;
  layout?: "row" | "column";
  compact?: "auto" | "always" | "never";
  /** The list's accessible name ("Upload steps"). */
  label?: string;
  className?: string;
}) {
  const items = resolve(steps, current);
  const now = items.find((s) => s.state === "current") ?? items[current - 1];

  const list = (
    <ol className={cx("wl-stepper", `wl-stepper--${layout}`)} aria-label={label}>
      {items.map((s) => (
        <li
          key={s.n}
          className={`wl-step wl-step--${s.state}`}
          aria-current={s.state === "current" ? "step" : undefined}
        >
          <span className="wl-step__disc" aria-hidden="true">
            {s.state === "done" ? (
              <Check {...iconProps} />
            ) : s.state === "busy" ? (
              <LoaderCircle {...iconProps} />
            ) : (
              s.n
            )}
          </span>
          <span className="wl-step__text">
            <span className="wl-step__label">
              {s.label}
              <span className="sr-only">, {STATE_WORDS[s.state]}</span>
            </span>
            {s.sub && <span className="wl-step__sub">{s.sub}</span>}
          </span>
        </li>
      ))}
    </ol>
  );

  const bar = (
    <div className="wl-stepbar">
      <span className="wl-stepbar__count">
        {current}
        <span>
          {" "}
          of {items.length}
          {now ? ` · ${now.label}` : ""}
        </span>
      </span>
      <span className="wl-stepbar__bars" aria-hidden="true">
        {items.map((s) => (
          <i key={s.n} data-on={s.n <= current ? "" : undefined} />
        ))}
      </span>
    </div>
  );

  if (compact === "always") return <div className={className}>{bar}</div>;
  if (compact === "never") return <div className={className}>{list}</div>;
  return (
    <div className={cx("wl-stephead--auto", className)}>
      {list}
      {bar}
    </div>
  );
}
