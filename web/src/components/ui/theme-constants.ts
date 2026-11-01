import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

/** Theme values shared by theme.tsx (server-safe), theme-client.tsx and theme-server.tsx. */

export type ThemeChoice = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

/** localStorage key and cookie name. */
export const THEME_STORAGE_KEY = "wideline-theme";
export const DEFAULT_THEME: ThemeChoice = "dark";

/** The account-menu theme radio, in order, with the design's labels and icons. */
export const THEME_OPTIONS: readonly { value: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "Match system", icon: Monitor },
];

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "dark" || value === "light" || value === "system";
}
