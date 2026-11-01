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
 * One thing in depth, with a hero (Floodlight): a player profile, a match. The title is
 * display-xl (56px, Archivo 800, 125% wide, caps) from 768px and 28px on phones; section
 * heads are heading-section caps.
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
        <div className="flex flex-col gap-4 tablet:flex-row tablet:items-start tablet:gap-6">
          {media && <div className="shrink-0">{media}</div>}
          <div className="min-w-0">
            {eyebrow && <p className="wl-pagehead__crumb m-0 mb-2">{eyebrow}</p>}
            <h1 id={titleId} className="wl-hero__title">
              {title}
            </h1>
            {meta && <p className="m-0 mt-2 text-ink-muted">{meta}</p>}
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
            className="wl-section-title"
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
