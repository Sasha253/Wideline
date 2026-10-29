import { useId, type ReactNode } from "react";
import { BackLinkButton, type BackLink } from "./PageHeader";

export type DetailSection = {
  id: string;
  title: string;
  content: ReactNode;
  /** A stable h2 id other links point at ("#import"); the h2 then takes focus (C09). */
  anchor?: string;
};

/**
 * One thing in depth, with a hero (docs/build/design/D02.md, Surface 5): a player
 * profile (C13), a match (C06). `display-xl` from 768px, `heading-1` on phones.
 */
export function DetailPage({
  back,
  eyebrow,
  title,
  meta,
  badges,
  actions,
  media,
  notice,
  sections,
}: {
  back?: BackLink;
  eyebrow?: ReactNode;
  title: string;
  /** Leave out missing fields; never show an empty separator. */
  meta?: ReactNode;
  badges?: ReactNode;
  /** At most one primary button. */
  actions?: ReactNode;
  /** An initials avatar or a mini pitch. */
  media?: ReactNode;
  /** Between the hero and the sections: a result banner slot or a state note (C04). */
  notice?: ReactNode;
  sections: DetailSection[];
}) {
  const titleId = useId();
  return (
    <>
      {back && (
        <div className="mb-4">
          <BackLinkButton {...back} />
        </div>
      )}
      <section aria-labelledby={titleId} className="wl-hero">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
          {media && <div className="shrink-0">{media}</div>}
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow text-ink-muted">{eyebrow}</p>}
            {/* Type classes cannot switch by breakpoint; the hidden span is display: none. */}
            <h1 id={titleId} className="break-words">
              <span className="heading-1 md:hidden">{title}</span>
              <span className="display-xl hidden md:inline">{title}</span>
            </h1>
            {meta && <p className="body mt-2 text-ink-muted">{meta}</p>}
            {badges && <div className="wl-row mt-3">{badges}</div>}
            {actions && <div className="wl-row mt-6">{actions}</div>}
          </div>
        </div>
      </section>
      {notice}
      {sections.map((s) => (
        <section key={s.id} aria-labelledby={s.anchor ?? `${titleId}-${s.id}`} className="mt-8">
          <h2
            id={s.anchor ?? `${titleId}-${s.id}`}
            className="heading-2"
            tabIndex={s.anchor ? -1 : undefined}
          >
            {s.title}
          </h2>
          <div className="mt-4">{s.content}</div>
        </section>
      ))}
    </>
  );
}
