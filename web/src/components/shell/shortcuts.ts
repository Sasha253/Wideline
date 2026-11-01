"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * The account menu's "Keyboard shortcuts" item (Floodlight app shell). Wideline has no global
 * shortcuts: the list belongs to the page that has them (the review workspace, the marker
 * tool). A page registers how to open its list, and while it is mounted the account menu shows
 * the item with its `?` key. Without a registered page the item is not shown, so it never
 * leads nowhere.
 *
 *   // In the review workspace (a client component):
 *   useKeyboardShortcutsEntry(() => setShortcutsOpen(true));
 */

type Open = () => void;

let current: Open | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Registers the page's shortcut list while the calling component is mounted. */
export function useKeyboardShortcutsEntry(open: Open | null) {
  useEffect(() => {
    if (!open) return;
    current = open;
    emit();
    return () => {
      if (current === open) {
        current = null;
        emit();
      }
    };
  }, [open]);
}

/** The registered opener, or null. The account menu reads this. */
export function useKeyboardShortcutsOpener(): Open | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
