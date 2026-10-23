import { REVIEWER_TERMS, REVIEWER_TERMS_VERSION } from "@/server/scouts/terms";

/**
 * The reviewer confidentiality terms (docs/build/design/C02.md, Surface 2), on
 * /register and /scout. The text lives in src/server/scouts/terms.ts only.
 * No inner scroll box: the page scrolls.
 */
export function TermsText({ className }: { className?: string }) {
  return (
    <div className={className ? `wl-terms wl-card ${className}` : "wl-terms wl-card"}>
      {REVIEWER_TERMS.map((t) => (
        <div key={t.heading}>
          <h3 className="body-strong">{t.heading}</h3>
          <p className="body">{t.body}</p>
        </div>
      ))}
      <p className="caption text-ink-muted">Version {REVIEWER_TERMS_VERSION}</p>
    </div>
  );
}
