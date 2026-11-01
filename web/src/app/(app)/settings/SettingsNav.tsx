import Link from "next/link";

export type SettingsTab = "organisation" | "members" | "review";

const TABS: { tab: SettingsTab; href: string; label: string }[] = [
  { tab: "organisation", href: "/settings/organisation", label: "Organisation" },
  { tab: "members", href: "/settings/members", label: "Members" },
  // C11 (REVIEW10): the auto-accept thresholds. Coaches see only this tab (Q-071).
  { tab: "review", href: "/settings/review", label: "Review" },
];

/**
 * The tabs an owner or admin sees. Review settings exist only for academies and clubs
 * (settings/review/page.tsx 404s for other organisations), so the tab shows only there.
 * Pass `isSquadOrg(ctx.organisationType)`.
 */
export function adminSettingsTabs(squad: boolean): SettingsTab[] {
  return squad ? ["organisation", "members", "review"] : ["organisation", "members"];
}

/**
 * The settings sub-nav (Floodlight page tabs): links, not ARIA tabs, because each one is a
 * URL. The current tab has the 2px ink underline, never lime.
 *
 * Rendered as the raw link tabs (`.wl-tabs` in core.css, the same styles as the Tabs
 * component), so it stays a server component.
 */
export function SettingsNav({
  current,
  tabs,
}: {
  current: SettingsTab;
  tabs: readonly SettingsTab[];
}) {
  return (
    <nav aria-label="Settings" className="wl-tabs mt-6">
      {TABS.filter((t) => tabs.includes(t.tab)).map((t) => (
        <Link key={t.tab} href={t.href} aria-current={t.tab === current ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
