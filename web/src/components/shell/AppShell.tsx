import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { ORG_TYPE_LABELS, ROLE_LABELS } from "@/lib/labels";
import { navForRoles } from "@/lib/nav";
import type { UserContext } from "@/server/auth/session";
import { AccountMenu } from "./AccountMenu";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { NavLinks } from "./NavLinks";
import { OrgSwitcher, type SwitcherOrganisation } from "./OrgSwitcher";
import { Logo } from "@/components/ui/Logo";

/**
 * The authenticated shell (docs/build/design/D02.md, Surface 1): a sidebar from 992px,
 * a rail from 768 to 991px, and a top bar plus a bottom tab bar under 768px. DOM order is
 * visual order is tab order. The nav is a convenience: every page still calls
 * requirePageRole() (AUTH06).
 */
export function AppShell({ ctx, children }: { ctx: UserContext; children: ReactNode }) {
  const hasOrg = ctx.organisationId !== null;
  const items = hasOrg ? navForRoles(ctx.roles, ctx.organisationType) : [];
  const hasTabBar = items.length > 0;
  const user = { name: ctx.user.name, email: ctx.user.email };
  const organisations: SwitcherOrganisation[] = ctx.organisations.map((o) => ({
    id: o.id,
    name: o.name,
    typeLabel: ORG_TYPE_LABELS[o.type],
    rolesLabel: o.roles.map((r) => ROLE_LABELS[r]).join(", "),
  }));
  const switcher = (variant: "sidebar" | "rail" | "topbar") =>
    ctx.organisationId ? (
      <OrgSwitcher organisations={organisations} currentId={ctx.organisationId} variant={variant} />
    ) : null;

  return (
    <div className="wl-shell">
      <a className="wl-skip wl-btn wl-btn--secondary" href="#main">
        Skip to content
      </a>

      <aside className="wl-sidebar" aria-label="Sidebar">
        <Link href="/" className="wl-brand heading-2">
          <Logo />
        </Link>
        {hasOrg && (
          <div>
            <div className="wl-only-sidebar">{switcher("sidebar")}</div>
            <div className="wl-only-rail">{switcher("rail")}</div>
          </div>
        )}
        {hasOrg && (
          <nav aria-label="Main" className="wl-sidebar__nav">
            {items.length > 0 && <NavLinks items={items} variant="side" />}
          </nav>
        )}
        <div className="wl-sidebar__account">
          <div className="wl-only-sidebar">
            <AccountMenu user={user} variant="inline" />
          </div>
          <div className="wl-only-rail">
            <AccountMenu user={user} variant="rail" />
          </div>
        </div>
      </aside>

      <header className="wl-topbar">
        <Link href="/" className="wl-brand heading-2">
          <Logo />
        </Link>
        {hasOrg ? switcher("topbar") : <div className="flex-1" />}
        <AccountMenu user={user} variant="topbar" />
      </header>

      <main
        id="main"
        tabIndex={-1}
        className={cx(
          "wl-main px-4 pt-6 outline-none md:px-6 md:pb-8 md:pt-8 lg:px-8",
          hasTabBar && "wl-main--tabbar",
        )}
      >
        <div className="mx-auto max-w-7xl">
          {ctx.impersonator && (
            <ImpersonationBanner user={ctx.user} impersonator={ctx.impersonator} />
          )}
          {children}
        </div>
      </main>

      {hasTabBar && (
        <nav aria-label="Main" className="wl-tabbar">
          <NavLinks items={items} variant="tabbar" />
        </nav>
      )}
    </div>
  );
}
