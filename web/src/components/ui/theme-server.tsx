import "server-only";
import { cookies } from "next/headers";
import { ReviewThemeScopeClient } from "./theme-client";
import {
  DEFAULT_THEME,
  isThemeChoice,
  THEME_STORAGE_KEY,
  type ThemeChoice,
} from "./theme-constants";

/**
 * Server-side theme helpers. Not exported from ui/index.ts: client components import the
 * barrel, and next/headers is server-only. Import from "@/components/ui/theme-server".
 */

/** The user's stored theme choice (the cookie setThemeChoice writes), default dark. */
export async function getThemeChoice(): Promise<ThemeChoice> {
  const value = (await cookies()).get(THEME_STORAGE_KEY)?.value;
  return isThemeChoice(value) ? value : DEFAULT_THEME;
}

/**
 * The review workspace (and CV Lab) scope: always dark unless the user explicitly chose
 * Light. "Match system" stays dark here. Server-rendered from the cookie, so it never
 * flashes, then follows changes made in the account menu live.
 */
export async function ReviewThemeScope({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <ReviewThemeScopeClient initialChoice={await getThemeChoice()} className={className}>
      {children}
    </ReviewThemeScopeClient>
  );
}
