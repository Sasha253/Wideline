import Link from "next/link";

/** The settings sub-nav: links, not ARIA tabs, because each one is a URL. */
export function SettingsNav({ current }: { current: "organisation" | "members" }) {
  return (
    <nav aria-label="Settings" className="wl-tabs mt-6">
      <Link
        href="/settings/organisation"
        className="body-strong"
        aria-current={current === "organisation" ? "page" : undefined}
      >
        Organisation
      </Link>
      <Link
        href="/settings/members"
        className="body-strong"
        aria-current={current === "members" ? "page" : undefined}
      >
        Members
      </Link>
    </nav>
  );
}
