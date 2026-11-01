"use client";

import { Ellipsis, Keyboard, LogOut, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId } from "react";
import { cx } from "@/components/ui/cx";
import { useTheme } from "@/components/ui/theme";
import { authClient } from "@/lib/auth-client";
import { useKeyboardShortcutsOpener } from "./shortcuts";
import { usePopover } from "./usePopover";

type Account = { name: string; email: string };

/**
 * Where the menu sits. `sidebar` is the account row at the foot of the 232px sidebar;
 * `rail` the 36px avatar at the foot of the rail; `topbar` the avatar in the phone top bar.
 * `inline` is the old name of `sidebar`.
 */
export type AccountMenuVariant =
  "sidebar" | "rail" | "topbar" | /** @deprecated use "sidebar" */ "inline";

/** Initials for the account avatar: first and last name ("Nomvula Mthembu" is "NM"). */
export function personInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const first = words[0]![0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]![0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

const PLACEMENT: Record<Exclude<AccountMenuVariant, "inline">, string> = {
  sidebar: "wl-popover--beside-end",
  rail: "wl-popover--beside-end",
  topbar: "wl-popover--below-end",
};

const icon16 = { size: 16, strokeWidth: 1.8, "aria-hidden": true } as const;
const icon17 = { size: 17, strokeWidth: 1.8, "aria-hidden": true } as const;

/**
 * Who is signed in, the theme (Dark / Light / Match system), keyboard shortcuts when the page
 * has them, your organisations, and Sign out (Floodlight app shell). The theme choice lives
 * only here. A disclosure popover in every variant; the trigger is named "Account and theme".
 */
export function AccountMenu({ user, variant }: { user: Account; variant: AccountMenuVariant }) {
  const where = variant === "inline" ? "sidebar" : variant;
  const { open, close, wrapperProps, triggerProps, panelProps } = usePopover();
  const initials = personInitials(user.name);

  return (
    <div
      {...wrapperProps}
      className={cx(
        "relative",
        where === "rail" && "flex justify-center",
        where === "topbar" && "shrink-0",
      )}
    >
      {where === "sidebar" ? (
        <button type="button" {...triggerProps} className="wl-account-row">
          <span className="wl-person" aria-hidden="true">
            {initials}
          </span>
          <span className="wl-account-row__text">
            <span className="wl-account-row__name" title={user.name}>
              {user.name}
            </span>{" "}
            <span className="wl-account-row__meta">Account and theme</span>
          </span>
          <Ellipsis {...icon16} className="wl-account-row__more" />
        </button>
      ) : (
        <button
          type="button"
          {...triggerProps}
          aria-label="Account and theme"
          title={where === "rail" ? user.name : undefined}
          className={cx("wl-account-avatar", where === "topbar" && "wl-account-avatar--topbar")}
        >
          <span className="wl-person" aria-hidden="true">
            {initials}
          </span>
        </button>
      )}
      {/* Kept in the DOM while closed (hidden), so it is ready the moment it opens. */}
      <div
        {...panelProps}
        role="region"
        aria-label="Account"
        hidden={!open}
        className={cx("wl-popover wl-popover--menu wl-account-menu", PLACEMENT[where])}
      >
        <div className="wl-account-menu__who">
          <span className="wl-person wl-person--l" aria-hidden="true">
            {initials}
          </span>
          <span className="min-w-0">
            <span className="wl-account-menu__name">{user.name}</span>
            <span className="wl-account-menu__email">{user.email}</span>
          </span>
        </div>
        <ThemeRadio />
        <ShortcutsItem onOpen={() => close(false)} />
        <Link href="/organisations" className="wl-menu-item" onClick={() => close(false)}>
          <User {...icon17} />
          <span className="flex-1">Your organisations</span>
        </Link>
        <SignOutItem />
      </div>
    </div>
  );
}

/** Dark / Light / Match system, as a native radio group (arrow keys move and choose). */
function ThemeRadio() {
  const { choice, setChoice, options } = useTheme();
  const name = useId();
  const labelId = `${name}-label`;
  return (
    <div className="wl-theme">
      <p id={labelId} className="wl-theme__label">
        Theme
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="wl-theme__options">
        {options.map((o) => {
          const Icon = o.icon;
          return (
            <label key={o.value} className="wl-theme__option">
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={choice === o.value}
                onChange={() => setChoice(o.value)}
                className="sr-only"
              />
              <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
              {o.label}
            </label>
          );
        })}
      </div>
      <p className="wl-theme__note">
        Dark is the default. The review workspace stays dark unless you choose Light here.
      </p>
    </div>
  );
}

/** Shown only while the page registers a shortcut list (shortcuts.ts). */
function ShortcutsItem({ onOpen }: { onOpen: () => void }) {
  const openShortcuts = useKeyboardShortcutsOpener();
  if (!openShortcuts) return null;
  return (
    <button
      type="button"
      className="wl-menu-item"
      aria-keyshortcuts="?"
      onClick={() => {
        onOpen();
        openShortcuts();
      }}
    >
      <Keyboard {...icon17} />
      <span className="flex-1">Keyboard shortcuts</span>
      <kbd className="wl-menu-item__kbd">?</kbd>
    </button>
  );
}

function SignOutItem() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="wl-menu-item wl-menu-item--separated"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      <LogOut {...icon17} />
      <span className="flex-1">Sign out</span>
    </button>
  );
}
