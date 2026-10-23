import { ArrowLeftRight } from "lucide-react";
import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import { ButtonLink } from "@/components/ui/Button";
import { requireUser } from "@/server/auth/session";
import { AppNav, type NavItem } from "./AppNav";

/**
 * Interim authenticated layout (C01): the wordmark, the active organisation,
 * nav by role and sign out. D02 replaces it with the full shell and switcher.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireUser();

  const nav: NavItem[] = [];
  if (ctx.roles.includes("owner") || ctx.roles.includes("admin")) {
    nav.push(
      { href: "/settings/members", label: "Members" },
      { href: "/settings/organisation", label: "Settings" },
    );
  }
  if (ctx.roles.includes("platform_admin")) {
    nav.push(
      { href: "/admin/organisations", label: "Applications" },
      { href: "/lab/matches", label: "Lab" },
    );
  }
  nav.push({ href: "/organisations", label: "Organisations" });

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 wl-btn wl-btn--secondary"
      >
        Skip to content
      </a>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-surface-sunken px-4 py-3 md:px-6 lg:px-8">
        <Link href="/" className="heading-2 text-ink no-underline">
          Wideline
        </Link>
        {/* Before the org block in the DOM, so it shares the first row with the wordmark on phones. */}
        <div className="ml-auto flex items-center gap-3 md:order-2 lg:order-3">
          <span className="caption hidden text-ink-muted md:inline">{ctx.user.name}</span>
          <SignOutButton />
        </div>
        {ctx.organisationId && (
          <>
            <div className="flex min-w-0 basis-full items-center gap-3 md:order-1 md:basis-auto md:flex-1">
              <div className="min-w-0">
                <p className="eyebrow text-ink-muted">Organisation</p>
                <p
                  className="body-strong truncate"
                  title={ctx.organisationName}
                  data-testid="active-organisation"
                >
                  {ctx.organisationName}
                </p>
              </div>
              {ctx.organisations.length > 1 && (
                <ButtonLink
                  href="/organisations"
                  variant="ghost"
                  size="sm"
                  icon={ArrowLeftRight}
                  aria-label="Switch organisation"
                  className="shrink-0"
                >
                  Switch
                </ButtonLink>
              )}
            </div>
            <AppNav items={nav} />
          </>
        )}
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8 lg:px-8">
        {children}
      </main>
    </div>
  );
}
