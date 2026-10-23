import Link from "next/link";
import { ThemeScope } from "@/components/ui/theme";
import { DEV_ROLES, requirePageRole } from "@/server/auth/session";
import { Gallery } from "./Gallery";

export const metadata = { title: "Components" };

// Full-bleed bands: break out of the main gutters, then put them back inside.
const band = "-mx-4 px-4 py-8 md:-mx-6 md:px-6 md:py-12 lg:-mx-8 lg:px-8";

/**
 * The component gallery: every design-system component in every variant, in a
 * forced light band and a forced dark band. Playwright baselines and axe run
 * against it. Wideline staff only.
 */
export default async function ComponentsPage() {
  await requirePageRole(DEV_ROLES);

  return (
    <main id="main" className="px-4 pb-12 pt-6 md:px-6 md:pt-8 lg:px-8">
      <h1 className="heading-1">Components</h1>
      <p className="body mt-2 max-w-prose text-ink-muted">
        Every Wideline component in every variant. The light and dark sections below are forced with
        ThemeScope; the rest of this page follows your system setting. Sample data only.
      </p>
      <nav aria-label="On this page" className="wl-row mt-4">
        <span className="caption text-ink-muted">On this page:</span>
        <a href="#light-theme" className="text-pitch underline">
          Light theme
        </a>
        <a href="#dark-theme" className="text-pitch underline">
          Dark theme
        </a>
      </nav>
      <p className="caption mt-2 text-ink-muted">
        See also:{" "}
        <Link href="/dev/templates" className="text-pitch underline">
          Page templates
        </Link>
      </p>
      <ThemeScope theme="light" className={`mt-8 ${band}`}>
        <Gallery theme="light" />
      </ThemeScope>
      <ThemeScope theme="dark" className={band}>
        <Gallery theme="dark" />
      </ThemeScope>
    </main>
  );
}
