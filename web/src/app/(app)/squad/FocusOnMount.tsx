"use client";

import { useEffect } from "react";

/**
 * Moves focus to the page's h1 once, after a redirect with a result
 * (docs/build/design/C04.md: after Mark as departed, focus lands on the h1).
 */
export function FocusHeadingOnMount() {
  useEffect(() => {
    const h1 = document.querySelector<HTMLElement>("main h1");
    if (!h1) return;
    h1.tabIndex = -1;
    h1.focus();
  }, []);
  return null;
}
