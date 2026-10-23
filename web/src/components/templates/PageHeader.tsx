import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { iconProps } from "@/components/ui/icons";

export type BackLink = { href: string; label: string };

export type PageHeaderProps = {
  title: ReactNode;
  eyebrow?: ReactNode;
  intro?: ReactNode;
  /** At most one primary button. */
  actions?: ReactNode;
  back?: BackLink;
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

/** The one header pattern for every page (docs/build/design/D02.md, Surface 5). */
export function PageHeader({ title, eyebrow, intro, actions, back }: PageHeaderProps) {
  return (
    <header>
      {back && (
        <div className="mb-2">
          <BackLinkButton {...back} />
        </div>
      )}
      <div className="md:flex md:flex-wrap md:items-end md:justify-between md:gap-4">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow text-ink-muted">{eyebrow}</p>}
          <h1 className="heading-1 break-words">{title}</h1>
          {intro && <p className="body mt-2 max-w-prose text-ink-muted">{intro}</p>}
        </div>
        {actions && <div className="wl-row mt-4 md:mt-0">{actions}</div>}
      </div>
    </header>
  );
}
