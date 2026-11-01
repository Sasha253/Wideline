import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { iconProps } from "@/components/ui/icons";

export type BackLink = { href: string; label: string };

export type PageHeaderProps = {
  title: ReactNode;
  /** The overline above the title: a breadcrumb or context ("Wideline Demo FC / Squad"). */
  eyebrow?: ReactNode;
  intro?: ReactNode;
  /** At most one primary button. */
  actions?: ReactNode;
  back?: BackLink;
  /** Under the title row: tabs, filters, or a StateMessage that keeps the header in place. */
  children?: ReactNode;
};

/** "← Matches", read as "Back to Matches". Shared by PageHeader and DetailPage. */
export function BackLinkButton({ href, label }: BackLink) {
  return (
    <Link href={href} className="wl-btn wl-btn--ghost wl-btn--sm -ml-3">
      <ArrowLeft {...iconProps} />
      <span className="sr-only">Back to </span>
      {label}
    </Link>
  );
}

/**
 * The one header pattern for every page (Floodlight): an overline, the page title in
 * display-l (Archivo 800, 125% wide, caps; 28px on phones), an intro, and the actions on
 * the right from 768px.
 */
export function PageHeader({ title, eyebrow, intro, actions, back, children }: PageHeaderProps) {
  return (
    <header className="wl-pagehead">
      {back && (
        <div>
          <BackLinkButton {...back} />
        </div>
      )}
      <div className="flex flex-col gap-4 tablet:flex-row tablet:flex-wrap tablet:items-end tablet:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          {eyebrow && <p className="wl-pagehead__crumb m-0">{eyebrow}</p>}
          <h1 className="wl-pagehead__title">{title}</h1>
          {intro && <p className="wl-pagehead__intro">{intro}</p>}
        </div>
        {actions && <div className="wl-row">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
