"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui/cx";

export type NavItem = { href: string; label: string };

/** The interim header nav. The current link carries aria-current and the pitch-soft fill. */
export function AppNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="wl-row basis-full md:order-3 lg:order-2 lg:basis-auto">
      {items.map((item) => {
        const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={cx("wl-btn wl-btn--ghost wl-btn--sm", current && "bg-pitch-soft")}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
