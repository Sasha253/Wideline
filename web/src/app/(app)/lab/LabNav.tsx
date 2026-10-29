"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The CV Lab sub-navigation (docs/build/design/C09.md, Surface 1): links, not
 * ARIA tabs, because each one is a URL. Matches is "page" on the list and
 * "true" on any page under it.
 */
export function LabNav() {
  const path = usePathname() ?? "";
  const matches =
    path === "/lab/matches" ? "page" : path.startsWith("/lab/matches/") ? "true" : undefined;
  return (
    <nav aria-label="CV Lab" className="wl-tabs">
      <Link href="/lab/matches" className="body-strong" aria-current={matches}>
        Matches
      </Link>
      <Link
        href="/lab/benchmark"
        className="body-strong"
        aria-current={path === "/lab/benchmark" ? "page" : undefined}
      >
        Benchmark
      </Link>
    </nav>
  );
}
