"use client";

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A disclosure popover (docs/build/design/D02.md, Surface 3): a button with
 * aria-expanded and aria-controls, and a panel. Not an ARIA menu, because the
 * panels hold forms and links. Used by the org switcher, the account menu and
 * the tab bar's More.
 *
 * - Opening moves focus to the first focusable element in the panel.
 * - Arrow up and down (and Home, End) move between the panel's items (A11Y.md: menus and the
 *   organisation switcher use arrow keys, Enter and Esc). Radios keep their own arrow keys.
 * - Escape closes and returns focus to the trigger.
 * - Focus leaving the wrapper (trigger plus panel) closes it.
 * - A pointer-down outside the wrapper closes it without moving focus.
 *
 * PlayerCardMenu keeps its own inline logic: it is an ARIA menu with arrow keys.
 */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (panelRef.current) focusables(panelRef.current)[0]?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  return {
    open,
    close,
    panelId,
    wrapperProps: {
      ref: wrapperRef,
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          close(true);
          return;
        }
        if (open) moveFocus(e, panelRef.current);
      },
      // A null relatedTarget (a click on a button that takes no focus, a button
      // disabled while pending) is left to the pointer-down handler.
      onBlur: (e: FocusEvent) => {
        const next = e.relatedTarget as Node | null;
        if (open && next && !wrapperRef.current?.contains(next)) setOpen(false);
      },
    },
    triggerProps: {
      ref: triggerRef,
      "aria-expanded": open,
      "aria-controls": open ? panelId : undefined,
      onClick: () => setOpen((o) => !o),
    },
    panelProps: { ref: panelRef, id: panelId },
  };
}

const MOVE_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

/** Roving focus between the panel's focusable items, wrapping at the ends. */
function moveFocus(e: KeyboardEvent, panel: HTMLElement | null) {
  if (!panel || e.defaultPrevented || !MOVE_KEYS.has(e.key)) return;
  const target = e.target as HTMLElement;
  if (!panel.contains(target)) return;
  if (target instanceof HTMLInputElement && target.type === "radio") return;
  const items = focusables(panel);
  if (items.length === 0) return;
  const at = items.indexOf(target);
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? items.length - 1
        : e.key === "ArrowDown"
          ? (at + 1) % items.length
          : (at - 1 + items.length) % items.length;
  e.preventDefault();
  items[next]?.focus();
}

/** The panel's focusable items in order; of a radio group only the checked radio counts. */
function focusables(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !(el instanceof HTMLInputElement && el.type === "radio" && !el.checked),
  );
}
