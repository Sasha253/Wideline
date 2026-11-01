"use client";

import {
  BadgeCheck,
  Bookmark,
  FlaskConical,
  LayoutDashboard,
  ListChecks,
  Menu,
  Settings,
  Users,
  Video,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  isCurrent,
  NAV_PLATFORM_ROLES,
  NAV_SCOUT_ROLES,
  type NavIcon,
  type NavItem,
} from "@/lib/nav";
import { usePopover } from "./usePopover";

// The design system reserves star, shield-check, shield-off and flag; the shell never uses them.
const ICONS: Record<NavIcon, LucideIcon> = {
  LayoutDashboard,
  Users,
  Video,
  Settings,
  ListChecks,
  Bookmark,
  BadgeCheck,
  Wrench,
  FlaskConical,
};

/** Lucide at 1.8 stroke and 20px (Floodlight). */
export const shellIcon = { size: 20, strokeWidth: 1.8, "aria-hidden": true } as const;

/** The tab bar holds at most this many slots; with more items, the last slot is More. */
const TAB_SLOTS = 5;

/** Shorter tab bar labels where the full one would not fit a fifth of a phone (design). */
const TAB_LABELS: Partial<Record<string, string>> = { review: "Queue" };

/**
 * A count beside a nav item. Only where action is waiting (matches needing a lineup,
 * matches in the queue), never for news. `hint` is the tooltip and screen-reader wording,
 * e.g. "2 need a lineup".
 */
export type NavCount = { count: number; hint: string };
/** Counts by nav item id ("matches", "review"). Items without one show no badge. */
export type NavCounts = Partial<Record<string, NavCount>>;

type GroupKey = "club" | "scouting" | "platform";
type NavGroup = { key: GroupKey; label: string; items: NavItem[] };

const GROUP_LABELS: Record<Exclude<GroupKey, "club">, string> = {
  scouting: "Scouting",
  platform: "Wideline staff",
};

function groupOf(item: NavItem): GroupKey {
  if (item.roles.some((r) => NAV_PLATFORM_ROLES.includes(r))) return "platform";
  if (item.roles.some((r) => NAV_SCOUT_ROLES.includes(r))) return "scouting";
  return "club";
}

/**
 * One group per role (design: "people with several roles see one group per role"). The club
 * group is named after the organisation; Wideline staff comes below any other role. The items
 * and their order are navForRoles' own.
 */
export function navGroups(items: NavItem[], organisationName?: string | null): NavGroup[] {
  const order: GroupKey[] = ["club", "scouting", "platform"];
  return order
    .map((key) => ({
      key,
      label: key === "club" ? (organisationName ?? "Club") : GROUP_LABELS[key],
      items: items.filter((i) => groupOf(i) === key),
    }))
    .filter((g) => g.items.length > 0);
}

const live = (c: NavCount | undefined): c is NavCount => !!c && c.count > 0;

/**
 * The main nav links. `side` is the sidebar (992px and up: labels, groups with headings when
 * there is more than one) and the rail (768 to 991px: icons only, a tooltip on hover and on
 * focus that Escape dismisses). One element; CSS switches the layout. `tabbar` is the phone
 * tab bar. The current item carries aria-current="page" and shows bg-selected with a 2px ink
 * inset (never lime).
 */
export function NavLinks({
  items,
  variant,
  counts,
  organisationName,
}: {
  items: NavItem[];
  variant: "side" | "tabbar";
  /** Waiting-action counts by item id. Optional: no badges without it. */
  counts?: NavCounts;
  /** Names the club group when the nav has more than one group. */
  organisationName?: string | null;
}) {
  const pathname = usePathname();
  const [tipsOff, setTipsOff] = useState(false);
  if (variant === "tabbar")
    return <TabBarLinks items={items} pathname={pathname} counts={counts ?? {}} />;

  const groups = navGroups(items, organisationName);
  const headed = groups.length > 1;
  return (
    <div
      className="wl-nav"
      data-tips={tipsOff ? "off" : undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape") setTipsOff(true);
      }}
      onFocus={() => setTipsOff(false)}
      onPointerLeave={() => setTipsOff(false)}
    >
      {groups.map((group) => {
        const headingId = `wl-nav-${group.key}`;
        return (
          <div key={group.key} className="wl-nav__group">
            {headed && (
              <p id={headingId} className="wl-nav__heading">
                {group.label}
              </p>
            )}
            <ul
              role="list"
              className="wl-nav__list"
              aria-labelledby={headed ? headingId : undefined}
            >
              {group.items.map((item) => {
                const Icon = ICONS[item.icon];
                const count = counts?.[item.id];
                return (
                  <li key={item.id} className="wl-nav__li">
                    <Link
                      href={item.href}
                      className="wl-nav__item"
                      aria-current={isCurrent(pathname, item) ? "page" : undefined}
                    >
                      <Icon {...shellIcon} />
                      <span className="wl-nav__label">{item.label}</span>
                      {live(count) && (
                        <>
                          <span className="wl-nav__count" aria-hidden="true">
                            {count.count}
                          </span>
                          <span className="sr-only">, {count.hint}</span>
                        </>
                      )}
                    </Link>
                    {/* Rail only: the name (and what is waiting) beside the icon. The link
                        already carries both, so the tooltip is hidden from screen readers. */}
                    <span className="wl-tooltip" aria-hidden="true">
                      <span className="wl-tooltip__title">{item.label}</span>
                      {live(count) && <span className="wl-tooltip__meta">{count.hint}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function TabLink({
  item,
  pathname,
  count,
}: {
  item: NavItem;
  pathname: string;
  count: NavCount | undefined;
}) {
  const Icon = ICONS[item.icon];
  return (
    <Link
      href={item.href}
      className="wl-tabbar__item"
      aria-current={isCurrent(pathname, item) ? "page" : undefined}
    >
      <span className="wl-tabbar__icon">
        <Icon {...shellIcon} />
        {live(count) && (
          <span className="wl-tabbar__count" aria-hidden="true">
            {count.count}
          </span>
        )}
      </span>
      <span className="wl-tabbar__label">{TAB_LABELS[item.id] ?? item.label}</span>
      {live(count) && <span className="sr-only">, {count.hint}</span>}
    </Link>
  );
}

function TabBarLinks({
  items,
  pathname,
  counts,
}: {
  items: NavItem[];
  pathname: string;
  counts: NavCounts;
}) {
  const overflow = items.length > TAB_SLOTS;
  const shown = overflow ? items.slice(0, TAB_SLOTS - 1) : items;
  const more = overflow ? items.slice(TAB_SLOTS - 1) : [];
  return (
    <>
      {shown.map((item) => (
        <TabLink key={item.id} item={item} pathname={pathname} count={counts[item.id]} />
      ))}
      {overflow && <MoreTab items={more} pathname={pathname} counts={counts} />}
    </>
  );
}

function MoreTab({
  items,
  pathname,
  counts,
}: {
  items: NavItem[];
  pathname: string;
  counts: NavCounts;
}) {
  const { open, wrapperProps, triggerProps, panelProps } = usePopover();
  const hiddenCurrent = items.some((item) => isCurrent(pathname, item));
  return (
    <div {...wrapperProps} className="wl-tabbar__more">
      <button
        type="button"
        {...triggerProps}
        className="wl-tabbar__item"
        aria-current={hiddenCurrent ? "true" : undefined}
      >
        <span className="wl-tabbar__icon">
          <Menu {...shellIcon} />
        </span>
        <span className="wl-tabbar__label">More</span>
      </button>
      {open && (
        <div
          {...panelProps}
          role="region"
          aria-label="More pages"
          className="wl-popover wl-popover--menu wl-popover--above-end"
        >
          <p className="wl-popover__heading">More pages</p>
          <ul role="list">
            {items.map((item) => {
              const Icon = ICONS[item.icon];
              const count = counts[item.id];
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="wl-popover__item"
                    aria-current={isCurrent(pathname, item) ? "page" : undefined}
                  >
                    <Icon {...shellIcon} />
                    <span className="flex-1">{item.label}</span>
                    {live(count) && (
                      <>
                        <span className="wl-nav__count" aria-hidden="true">
                          {count.count}
                        </span>
                        <span className="sr-only">, {count.hint}</span>
                      </>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
