import Link from "next/link";

export type AdminSection = "organisations" | "scouts" | "users";

const SECTIONS: { section: AdminSection; href: string; label: string }[] = [
  { section: "organisations", href: "/admin/organisations", label: "Organisations" },
  { section: "scouts", href: "/admin/scouts", label: "Scouts" },
  { section: "users", href: "/admin/users", label: "Users" },
];

/**
 * The admin sub-nav (Floodlight, "Admin · scout approvals": admin tabs under the page
 * header). Links, not ARIA tabs, because each one is a URL; the current one has the 2px
 * ink underline. Counts, when given, are mono and only show when something waits.
 *
 * Rendered as the raw link tabs (`.wl-tabs` in core.css, the same styles as the Tabs
 * component), so it stays a server component.
 */
export function AdminNav({
  current,
  counts,
}: {
  current: AdminSection;
  counts?: Partial<Record<AdminSection, number>>;
}) {
  return (
    <nav aria-label="Admin" className="wl-tabs mt-6">
      {SECTIONS.map((s) => {
        const count = counts?.[s.section];
        return (
          <Link
            key={s.section}
            href={s.href}
            aria-current={s.section === current ? "page" : undefined}
          >
            {s.label}
            {count ? (
              <span className="font-mono text-mono-m tabular-nums text-ink-muted">{count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
