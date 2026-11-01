import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { ThemeScope } from "@/components/ui/theme";
import { DEV_ROLES, requirePageRole } from "@/server/auth/session";
import { Gallery } from "./Gallery";

export const metadata = { title: "Components" };

// Full-bleed bands: break out of the main gutters, then put them back inside.
const band = "-mx-5 px-5 py-10 tablet:-mx-6 tablet:px-6 desktop:-mx-7 desktop:px-7 desktop:py-12";

/**
 * The component gallery (Floodlight): every core and football component in its states,
 * in a forced dark band (the default) and a forced light band. Playwright baselines and
 * axe run against it. Wideline staff only.
 */
export default async function ComponentsPage() {
  await requirePageRole(DEV_ROLES);

  return (
    <main
      id="main"
      className="bg-canvas px-5 pt-6 pb-12 text-ink tablet:px-6 desktop:px-7 desktop:pt-8"
    >
      <Logo size="m" />
      <p className="m-0 mt-8 font-mono text-overline uppercase text-ink-muted">
        Wideline staff / Design system
      </p>
      <h1 className="m-0 mt-2 font-display text-display-phone stretch-wide uppercase tablet:text-display-l">
        Components
      </h1>
      <p className="m-0 mt-3 max-w-prose text-ink-muted">
        Every Floodlight component in its states. The dark and light sections below are forced with
        ThemeScope; the rest of this page follows your theme. Sample data only.
      </p>
      <nav aria-label="On this page" className="wl-row mt-4 text-body-s">
        <span className="text-ink-muted">On this page:</span>
        <a href="#dark-theme" className="text-brand-text underline underline-offset-3">
          Dark theme
        </a>
        <a href="#light-theme" className="text-brand-text underline underline-offset-3">
          Light theme
        </a>
        <Link href="/dev/templates" className="text-brand-text underline underline-offset-3">
          Page templates
        </Link>
      </nav>
      <ThemeScope theme="dark" className={`mt-8 bg-canvas text-ink ${band}`}>
        <Gallery theme="dark" />
      </ThemeScope>
      <ThemeScope theme="light" className={`bg-canvas text-ink ${band}`}>
        <Gallery theme="light" />
      </ThemeScope>
    </main>
  );
}
