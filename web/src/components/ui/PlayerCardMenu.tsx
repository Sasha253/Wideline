"use client";

import { Ellipsis, Star, User } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { IconButton } from "./Button";
import { iconProps } from "./icons";

/**
 * The PlayerCard's "More actions" menu: View profile, and Add to shortlist when
 * the caller supplies a handler or a link. Always visible, so it works with a
 * mouse, touch and the keyboard alike.
 *
 * Keyboard: Enter, Space or ArrowDown opens it and focuses the first item.
 * ArrowUp and ArrowDown wrap, Home and End jump. Escape closes and returns
 * focus to the trigger. Tab closes and moves on. A click outside closes it.
 */
export function PlayerCardMenu({
  name,
  profileHref,
  onAddToShortlist,
  shortlistHref,
}: {
  name: string;
  profileHref: string;
  onAddToShortlist?: () => void;
  shortlistHref?: string;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const items = () =>
    Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const onTriggerKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKeyDown = (e: KeyboardEvent) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const move = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(list.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      // Move focus back first, so the browser's Tab continues from the trigger.
      trigger.current?.focus();
      close(false);
    }
  };

  return (
    <div ref={wrapper} className="relative">
      <IconButton
        ref={trigger}
        icon={Ellipsis}
        aria-label={`More actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
      />
      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={`Actions for ${name}`}
          className="wl-menu"
          onKeyDown={onMenuKeyDown}
        >
          <Link
            role="menuitem"
            href={profileHref}
            className="wl-menu__item text-body"
            tabIndex={-1}
          >
            <User {...iconProps} />
            View profile
          </Link>
          {shortlistHref ? (
            <Link
              role="menuitem"
              href={shortlistHref}
              className="wl-menu__item text-body"
              tabIndex={-1}
            >
              <Star {...iconProps} />
              Add to shortlist
            </Link>
          ) : onAddToShortlist ? (
            <button
              type="button"
              role="menuitem"
              className="wl-menu__item text-body"
              tabIndex={-1}
              onClick={() => {
                onAddToShortlist();
                close(true);
              }}
            >
              <Star {...iconProps} />
              Add to shortlist
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
