"use client";

import { useSyncExternalStore } from "react";
import { cx } from "./cx";
import {
  DEFAULT_THEME,
  isThemeChoice,
  THEME_OPTIONS,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeChoice,
} from "./theme-constants";

/** Fired on window after setThemeChoice(), so every useTheme() in this tab re-renders. */
const CHANGE_EVENT = "wideline-theme-change";
const LIGHT_QUERY = "(prefers-color-scheme: light)";
const ONE_YEAR = 60 * 60 * 24 * 365;

function readChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeChoice(stored)) return stored;
  } catch {
    // Storage can be blocked; the cookie still holds the choice.
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${THEME_STORAGE_KEY}=([^;]*)`));
  return isThemeChoice(match?.[1]) ? match[1] : DEFAULT_THEME;
}

function systemIsLight(): boolean {
  return window.matchMedia(LIGHT_QUERY).matches;
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY) onChange();
  };
  const media = window.matchMedia(LIGHT_QUERY);
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  media.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
    media.removeEventListener("change", onChange);
  };
}

/**
 * Stores the user's theme choice in this browser and applies it at once: <html data-theme>,
 * every useTheme() and every ReviewThemeScope in this tab, and other open tabs.
 */
export function setThemeChoice(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage can be blocked; the cookie below still persists the choice.
  }
  document.cookie = `${THEME_STORAGE_KEY}=${choice}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  document.documentElement.dataset.theme = choice;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * The theme choice for the account menu's radio (Dark / Light / Match system).
 *
 * `choice` is what the user picked; `resolved` is what is on screen (system resolved with
 * prefers-color-scheme). Before hydration both read `serverChoice` (default dark), so server
 * and client markup match.
 *
 *   const { choice, setChoice, options } = useTheme();
 *   options.map((o) => <input type="radio" checked={choice === o.value}
 *     onChange={() => setChoice(o.value)} />)
 */
export function useTheme(serverChoice: ThemeChoice = DEFAULT_THEME): {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice: (choice: ThemeChoice) => void;
  options: typeof THEME_OPTIONS;
} {
  const choice = useSyncExternalStore(subscribe, readChoice, () => serverChoice);
  const light = useSyncExternalStore(subscribe, systemIsLight, () => false);
  const resolved: ResolvedTheme = choice === "system" ? (light ? "light" : "dark") : choice;
  return { choice, resolved, setChoice: setThemeChoice, options: THEME_OPTIONS };
}

/**
 * Client half of ReviewThemeScope (theme-server.tsx): dark unless the choice is Light, and
 * follows a change made in the account menu without a reload. Use ReviewThemeScope from a
 * server component; it reads the cookie so the first paint is already right.
 */
export function ReviewThemeScopeClient({
  initialChoice,
  className,
  children,
}: {
  initialChoice: ThemeChoice;
  className?: string;
  children: React.ReactNode;
}) {
  const { choice } = useTheme(initialChoice);
  return (
    <div
      data-theme={choice === "light" ? "light" : "dark"}
      className={cx("bg-canvas text-ink", className)}
    >
      {children}
    </div>
  );
}
