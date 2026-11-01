"use client";

import Link from "next/link";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

export type TabItem = {
  value: string;
  /** Sentence case, one or two words: "Overview", "Match log". */
  label: string;
  /** Shown in mono beside the label: "Clips 26". */
  count?: number | string;
  /** Navigation tabs: each tab is a link to its own URL. */
  href?: string;
  disabled?: boolean;
};

/** The id of a tab, for TabPanel's aria-labelledby. */
export const tabId = (tabsId: string, value: string) => `${tabsId}-tab-${value}`;
/** The id of a tab's panel, for the tab's aria-controls. */
export const tabPanelId = (tabsId: string, value: string) => `${tabsId}-panel-${value}`;

/** Moves focus along a row of tabs or radios with the arrow keys, Home and End. */
export function rovingKey(
  e: KeyboardEvent<HTMLElement>,
  container: HTMLElement | null,
  selector: string,
): HTMLElement | null {
  if (!container) return null;
  const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
  if (!keys.includes(e.key)) return null;
  const items = [...container.querySelectorAll<HTMLElement>(selector)].filter(
    (el) => el.getAttribute("aria-disabled") !== "true",
  );
  if (items.length === 0) return null;
  const current = items.indexOf(document.activeElement as HTMLElement);
  let next = current;
  if (e.key === "Home") next = 0;
  else if (e.key === "End") next = items.length - 1;
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
    next = current <= 0 ? items.length - 1 : current - 1;
  else next = current === items.length - 1 ? 0 : current + 1;
  e.preventDefault();
  const el = items[next]!;
  el.focus();
  return el;
}

/**
 * Page tabs (Floodlight, "Tabs"): switch between views of one thing, such as a player's
 * overview, match log and clips. Up to 5 tabs. The selected tab has a 2px ink underline
 * (never lime: lime is kept for what is live); counts are mono.
 *
 * Two modes:
 * - In-page panels (no `href`): an ARIA tablist. Arrow keys move between tabs and select
 *   them; Tab moves into the panel. Pair each tab with a <TabPanel tabsId={id} value=…>.
 * - Navigation (every item has `href`): a nav of links, the current one marked
 *   aria-current="page". Arrow keys also move between them.
 *
 * Not for step navigation: multi-step flows use a step header.
 */
export function Tabs({
  items,
  value,
  onValueChange,
  id: idProp,
  current = "page",
  className,
  ...aria
}: {
  items: TabItem[];
  /** The selected tab's value. */
  value: string;
  onValueChange?: (value: string) => void;
  /**
   * Navigation mode only: the aria-current value of the current link. "page" when the link
   * is this exact page, "true" when the page sits below it (a section nav on nested pages).
   */
  current?: "page" | "true";
  /** Base id for the tabs and their panels. Required to pair TabPanels. */
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const auto = useId();
  const id = idProp ?? auto;
  const ref = useRef<HTMLDivElement>(null);
  const navigation = items.length > 0 && items.every((t) => t.href !== undefined);

  const content = (t: TabItem) => (
    <>
      {t.label}
      {t.count !== undefined && <span className="wl-tabset__count">{t.count}</span>}
    </>
  );

  if (navigation) {
    return (
      <nav
        ref={ref}
        className={cx("wl-tabset", className)}
        onKeyDown={(e) => rovingKey(e, ref.current, ".wl-tabset__tab")}
        {...aria}
      >
        {items.map((t) =>
          t.disabled ? (
            <span key={t.value} className="wl-tabset__tab" aria-disabled="true">
              {content(t)}
            </span>
          ) : (
            <Link
              key={t.value}
              href={t.href!}
              className="wl-tabset__tab"
              aria-current={t.value === value ? current : undefined}
            >
              {content(t)}
            </Link>
          ),
        )}
      </nav>
    );
  }

  return (
    <div
      ref={ref}
      role="tablist"
      className={cx("wl-tabset", className)}
      onKeyDown={(e) => {
        const el = rovingKey(e, ref.current, '[role="tab"]');
        const next = el?.dataset.value;
        if (next !== undefined && next !== value) onValueChange?.(next);
      }}
      {...aria}
    >
      {items.map((t) => {
        const selected = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            id={tabId(id, t.value)}
            aria-controls={tabPanelId(id, t.value)}
            aria-selected={selected}
            aria-disabled={t.disabled || undefined}
            tabIndex={selected ? 0 : -1}
            data-value={t.value}
            className="wl-tabset__tab"
            onClick={() => !t.disabled && !selected && onValueChange?.(t.value)}
          >
            {content(t)}
          </button>
        );
      })}
    </div>
  );
}

/** The panel of one in-page tab. Focusable, so Tab moves from the tab into it. */
export function TabPanel({
  tabsId,
  value,
  selected,
  className,
  children,
}: {
  tabsId: string;
  value: string;
  selected: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={tabPanelId(tabsId, value)}
      aria-labelledby={tabId(tabsId, value)}
      tabIndex={0}
      hidden={!selected}
      className={className}
    >
      {children}
    </div>
  );
}
