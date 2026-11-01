"use client";

import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { cx } from "./cx";
import { rovingKey } from "./Tabs";

export type SegmentOption = {
  value: string;
  label: string;
  /** Mono count beside the label: "Pending 32". */
  count?: number | string;
  /**
   * An icon element before the label, e.g. <ShieldCheck {...iconProps} className="text-confirmed" />.
   * An element, not a component, so server pages can pass it to this client component.
   */
  icon?: ReactNode;
  /** Filters held in the URL: each option is a link. */
  href?: string;
  disabled?: boolean;
};

/**
 * A segmented filter (Floodlight, "Segmented filter"): narrows one list in place, 2 to 4
 * options (event status in review, consent on the squad). The selected option has the
 * selected fill plus a line-strong inset; counts are mono.
 *
 * - With onValueChange: a radiogroup. Arrow keys move and select; the group is one Tab
 *   stop. Set `name` to post the value with a form.
 * - With an href on every option: links, the current one marked aria-current="true".
 */
export function SegmentedFilter({
  options,
  value,
  onValueChange,
  name,
  fill = false,
  className,
  ...aria
}: {
  options: SegmentOption[];
  value: string;
  onValueChange?: (value: string) => void;
  /** Posts the selected value under this name (a hidden input). */
  name?: string;
  /** Stretch to the container, options sharing the width equally. */
  fill?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const links = options.length > 0 && options.every((o) => o.href !== undefined);
  const cls = cx("wl-segmented", fill && "wl-segmented--fill", className);

  const content = (o: SegmentOption) => (
    <>
      {o.icon}
      {o.label}
      {o.count !== undefined && <span className="wl-segmented__count">{o.count}</span>}
    </>
  );

  if (links) {
    return (
      <nav className={cls} {...aria}>
        {options.map((o) =>
          o.disabled ? (
            <span key={o.value} className="wl-segmented__option" aria-disabled="true">
              {content(o)}
            </span>
          ) : (
            <Link
              key={o.value}
              href={o.href!}
              className="wl-segmented__option"
              aria-current={o.value === value ? "true" : undefined}
            >
              {content(o)}
            </Link>
          ),
        )}
      </nav>
    );
  }

  // The checked option is the Tab stop; with none checked, the first enabled one is.
  const tabStop = options.some((o) => o.value === value && !o.disabled)
    ? value
    : options.find((o) => !o.disabled)?.value;

  return (
    <div
      ref={ref}
      role="radiogroup"
      className={cls}
      onKeyDown={(e) => {
        const el = rovingKey(e, ref.current, '[role="radio"]');
        const next = el?.dataset.value;
        if (next !== undefined && next !== value) onValueChange?.(next);
      }}
      {...aria}
    >
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={o.disabled || undefined}
            tabIndex={o.value === tabStop ? 0 : -1}
            data-value={o.value}
            className="wl-segmented__option"
            onClick={() => !o.disabled && !checked && onValueChange?.(o.value)}
          >
            {content(o)}
          </button>
        );
      })}
      {name && <input type="hidden" name={name} value={value} />}
    </div>
  );
}
