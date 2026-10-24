"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Refreshes the server-rendered page every `everyMs` while the tab is visible
 * (docs/build/design/C06.md, Surface 6): 10 s while footage is checked, 30 s
 * while the match is processing. It never moves focus.
 */
export function StatusPoller({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => window.clearInterval(id);
  }, [everyMs, router]);
  return null;
}
