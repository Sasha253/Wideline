import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { Logo, LogoMark } from "@/components/ui/Logo";
import { ORG_TYPE_LABELS, ROLE_LABELS } from "@/lib/labels";
import { navForRoles } from "@/lib/nav";
import type { UserContext } from "@/server/auth/session";
import { AccountMenu } from "./AccountMenu";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { NavLinks, type NavCounts } from "./NavLinks";
import { OrgSwitcher, type SwitcherOrganisation } from "./OrgSwitcher";

/**
 * The authenticated shell (Floodlight app shell): a 232px sidebar from 992px, a 64px icon
 * rail from 768 to 991px, and a 56px top bar plus a 56px bottom tab bar under 768px. One set
 * of items, from navForRoles; the nav is a convenience and every page still calls
 * requirePageRole() (AUTH06). DOM order is visual order is tab order.
 *
 * `counts` puts a count beside an item only where action is waiting (matches needing a
 * lineup, matches in the queue). Optional; without it no item shows a count.
 */
export function AppShell({
  ctx,
  counts,
  children,
}: {
  ctx: UserContext;
  counts?: NavCounts;
  children: ReactNode;
}) {
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
      <a className="wl-skip" href="#main">
        Skip to content
      </a>

      <aside className="wl-sidebar" aria-label="Sidebar">
        <Link href="/" className="wl-brand">
          <Logo size="m" className="wl-only-sidebar" />
          <span className="wl-only-rail">
            <LogoMark size="s" />
            <span className="sr-only">Wideline</span>
          </span>
        </Link>
        {hasOrg && (
          <div className="wl-sidebar__org">
            <div className="wl-only-sidebar">{switcher("sidebar")}</div>
            <div className="wl-only-rail">{switcher("rail")}</div>
          </div>
        )}
        {hasOrg && <span className="wl-rail-rule wl-only-rail" aria-hidden="true" />}
        {hasOrg && (
          <nav aria-label="Main" className="wl-sidebar__nav">
            {items.length > 0 && (
              <NavLinks
                items={items}
                variant="side"
                counts={counts}
                organisationName={ctx.organisationName}
              />
            )}
          </nav>
        )}
        <div className="wl-sidebar__account">
          <div className="wl-only-sidebar">
            <AccountMenu user={user} variant="sidebar" />
          </div>
          <div className="wl-only-rail">
            <AccountMenu user={user} variant="rail" />
          </div>
        </div>
      </aside>

      <header className="wl-topbar">
        {hasOrg ? (
          switcher("topbar")
        ) : (
          <Link href="/" className="wl-brand wl-topbar__brand">
            <Logo size="m" />
          </Link>
        )}
        <AccountMenu user={user} variant="topbar" />
      </header>

      <main id="main" tabIndex={-1} className={cx("wl-main", hasTabBar && "wl-main--tabbar")}>
        <div className="wl-main__inner">
          {ctx.impersonator && (
            <ImpersonationBanner user={ctx.user} impersonator={ctx.impersonator} />
          )}
          {children}
        </div>
      </main>

      {hasTabBar && (
        <nav aria-label="Main" className="wl-tabbar">
          <NavLinks items={items} variant="tabbar" counts={counts} />
        </nav>
      )}
    </div>
  );
}
