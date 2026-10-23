import { cx } from "./cx";

/**
 * Theme mechanism. <html data-theme> follows the system light or dark setting;
 * ThemeScope forces a subtree to one theme.
 *
 * Without JavaScript, the prefers-color-scheme block in tokens.css applies.
 * There is no user toggle and nothing is stored.
 */

// Runs before first paint, so the page never flashes the wrong theme. It also
// follows the system setting live, with no reload.
const script = `(function(){try{var m=window.matchMedia("(prefers-color-scheme: dark)");var d=document.documentElement;var s=function(){d.dataset.theme=m.matches?"dark":"light"};s();m.addEventListener("change",s)}catch(e){}})();`;

/** Inline script for <head>. Pair it with suppressHydrationWarning on <html>. */
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

/**
 * Forces its subtree to one theme, server-rendered so it never flashes.
 * tokens.css supports nested [data-theme] scopes.
 *
 * The CV Lab and the review workspace (C11) wrap themselves in
 * `<ThemeScope theme="dark">`: video reads better on dark.
 */
export function ThemeScope({
  theme,
  className,
  children,
}: {
  theme: "light" | "dark";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-theme={theme} className={cx("bg-surface text-ink", className)}>
      {children}
    </div>
  );
}
