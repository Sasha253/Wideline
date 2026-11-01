import { cx } from "./cx";

/**
 * Theme mechanism (Floodlight, docs/design-handoff/README.md, rule 6).
 *
 * - Dark is the default everywhere. The user can pick Dark, Light or Match system in the
 *   account menu. <html data-theme> holds the choice itself: "dark", "light" or "system"
 *   (wideline-tokens.css resolves "system" with prefers-color-scheme).
 * - The choice is stored in this browser: localStorage (so other tabs follow at once) and a
 *   cookie (so server components, like the review workspace scope, can read it).
 * - ThemeScript applies the stored choice before first paint, so nothing flashes.
 * - ThemeScope forces a subtree to one theme. ReviewThemeScope (theme-server.tsx) forces dark
 *   unless the user explicitly chose Light.
 *
 * Client API (theme-client.tsx): useTheme() and setThemeChoice().
 * Without JavaScript, the page is dark (the :root defaults in wideline-tokens.css).
 */

import { THEME_STORAGE_KEY, type ResolvedTheme } from "./theme-constants";

export {
  DEFAULT_THEME,
  isThemeChoice,
  THEME_OPTIONS,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeChoice,
} from "./theme-constants";

// Runs before first paint. Reads localStorage, then the cookie, and falls back to dark.
// It also follows a change made in another tab (the storage event), with no reload.
const script = `(function(){var K=${JSON.stringify(THEME_STORAGE_KEY)};var d=document.documentElement;function ok(v){return v==="dark"||v==="light"||v==="system"}function read(){var v=null;try{v=localStorage.getItem(K)}catch(e){}if(!ok(v)){var m=document.cookie.match(new RegExp("(?:^|; )"+K+"=([^;]*)"));v=m?m[1]:null}return ok(v)?v:"dark"}function apply(){d.dataset.theme=read()}apply();try{window.addEventListener("storage",function(e){if(e.key===K)apply()})}catch(e){}})();`;

/** Inline script for <head>. Pair it with suppressHydrationWarning on <html>. */
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

/**
 * Forces its subtree to one theme, server-rendered so it never flashes.
 * wideline-tokens.css supports nested [data-theme] scopes.
 *
 * For the review workspace use ReviewThemeScope instead: it stays dark unless the user
 * chose Light. ThemeScope theme="light" is for print views.
 */
export function ThemeScope({
  theme,
  className,
  children,
}: {
  theme: ResolvedTheme;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-theme={theme} className={cx("bg-canvas text-ink", className)}>
      {children}
    </div>
  );
}

export { setThemeChoice, useTheme } from "./theme-client";
