import { cx } from "@/components/ui/cx";
import { REVIEWER_TERMS, REVIEWER_TERMS_VERSION } from "@/server/scouts/terms";

/**
 * The reviewer confidentiality terms (Floodlight, "Registration · terms"), on /register and
 * /scout: numbered plain rules under an ink rule, then the version. The text lives in
 * src/server/scouts/terms.ts only. No inner scroll box: the page scrolls.
 */
export function TermsText({ className }: { className?: string }) {
  return (
    <div className={cx("flex flex-col gap-3", className)}>
      <ol className="m-0 list-none border-t border-ink p-0">
        {REVIEWER_TERMS.map((t, i) => (
          <li
            key={t.heading}
            className="grid grid-cols-[24px_minmax(0,1fr)] gap-3 border-b border-line py-3.5"
          >
            <span
              className="font-mono font-semibold text-ink-muted tabular-nums"
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <h3 className="m-0 text-body font-semibold">{t.heading}</h3>
              <p className="m-0 text-pretty">{t.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="m-0 text-body-s text-ink-muted">
        Version <span className="font-mono tabular-nums">{REVIEWER_TERMS_VERSION}</span>
      </p>
    </div>
  );
}
