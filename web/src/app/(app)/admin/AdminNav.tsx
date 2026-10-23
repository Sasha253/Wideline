import Link from "next/link";

/** The admin sub-nav (docs/build/design/C02.md, Surface 5): links, not ARIA tabs, because each one is a URL. */
export function AdminNav({ current }: { current: "organisations" | "scouts" }) {
  return (
    <nav aria-label="Admin" className="wl-tabs mt-6">
      <Link
        href="/admin/organisations"
        className="body-strong"
        aria-current={current === "organisations" ? "page" : undefined}
      >
        Organisations
      </Link>
      <Link
        href="/admin/scouts"
        className="body-strong"
        aria-current={current === "scouts" ? "page" : undefined}
      >
        Scouts
      </Link>
    </nav>
  );
}
