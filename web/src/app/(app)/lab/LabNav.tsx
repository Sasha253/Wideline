"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The CV Lab sub-navigation (docs/build/design/C09.md, Surface 1; Floodlight page tabs):
 * links, not ARIA tabs, because each one is a URL. Matches stays current on any page
 * under it: aria-current="page" on /lab/matches itself, "true" on the pages below it.
 *
 * Rendered as the raw link tabs (`.wl-tabs` in core.css), which share the Tabs component's
 * styles, because the current link changes between "page" and "true" by path.
 */
export function LabNav() {
  const path = usePathname() ?? "";
  const current = (href: string): "page" | "true" | undefined =>
    path === href ? "page" : path.startsWith(`${href}/`) ? "true" : undefined;
  return (
    <nav aria-label="CV Lab" className="wl-tabs">
      <Link href="/lab/matches" aria-current={current("/lab/matches")}>
        Matches
      </Link>
      <Link href="/lab/benchmark" aria-current={current("/lab/benchmark")}>
        Benchmark
      </Link>
    </nav>
  );
}
