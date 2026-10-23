"use client";

import {
  BadgeCheck,
  Bookmark,
  Ellipsis,
  FlaskConical,
  LayoutDashboard,
  ListChecks,
  Settings,
  Users,
  Video,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { iconProps } from "@/components/ui/icons";
import { isCurrent, type NavIcon, type NavItem } from "@/lib/nav";
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

/** The tab bar holds at most this many slots; with more items, the last slot is More. */
const TAB_SLOTS = 5;

/**
 * The main nav links (docs/build/design/D02.md, Surface 2). `side` is the sidebar and the
 * rail (one element: CSS switches the layout and the label size); `tabbar` is the phone
 * tab bar. The current item carries aria-current="page".
 */
export function NavLinks({ items, variant }: { items: NavItem[]; variant: "side" | "tabbar" }) {
  const pathname = usePathname();
  if (variant === "tabbar") return <TabBarLinks items={items} pathname={pathname} />;
  return (
    <ul role="list" className="wl-nav">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        return (
          <li key={item.id}>
            <Link
              href={item.href}
              className="wl-nav__item"
              aria-current={isCurrent(pathname, item) ? "page" : undefined}
            >
              <Icon {...iconProps} />
              {/* Two sizes, one shown: the hidden span is display: none, so the name is read once. */}
              <span className="body wl-only-sidebar">{item.label}</span>
              <span className="caption wl-only-rail">{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function TabBarLinks({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const overflow = items.length > TAB_SLOTS;
  const shown = overflow ? items.slice(0, TAB_SLOTS - 1) : items;
  const more = overflow ? items.slice(TAB_SLOTS - 1) : [];
  return (
    <>
      {shown.map((item) => {
        const Icon = ICONS[item.icon];
        return (
          <Link
            key={item.id}
            href={item.href}
            className="wl-tabbar__item"
            aria-current={isCurrent(pathname, item) ? "page" : undefined}
          >
            <Icon {...iconProps} />
            <span className="caption">{item.label}</span>
          </Link>
        );
      })}
      {overflow && <MoreTab items={more} pathname={pathname} />}
    </>
  );
}

function MoreTab({ items, pathname }: { items: NavItem[]; pathname: string }) {
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
        <Ellipsis {...iconProps} />
        <span className="caption">More</span>
      </button>
      {open && (
        <div
          {...panelProps}
          role="region"
          aria-label="More pages"
          className="wl-popover wl-popover--above-end"
        >
          <p className="wl-popover__heading label">More pages</p>
          <ul role="list">
            {items.map((item) => {
              const Icon = ICONS[item.icon];
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="wl-popover__item body"
                    aria-current={isCurrent(pathname, item) ? "page" : undefined}
                  >
                    <Icon {...iconProps} />
                    {item.label}
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
