import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { iconProps } from "@/components/ui/icons";
import { LogoMark } from "@/components/ui/Logo";

// Pieces of the guardian screens (Floodlight, "Guardian consent"). No hooks, so the
// client error boundary can use them too. Written for a reading age of about 12: one
// decision per screen, 56px main buttons and 64px answers.

/**
 * The frame of one guardian screen: Wideline's mark and the club's name, the step as
 * "2 of 4" with bars (a hairline when there is no step), the content, then the buttons at
 * the bottom of the column, then who to ask.
 */
export function GuardianFrame({
  club,
  step,
  actions,
  children,
}: {
  club: string | null;
  /** The step, counted from 1, and how many there are. */
  step?: { n: number; of: number };
  /** The buttons under the content. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <div className="flex flex-col gap-3 px-5 pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <LogoMark size="s" />
            <span className="min-w-0 break-words font-semibold">
              {club ?? <span className="uppercase stretch-wide font-extrabold">Wideline</span>}
            </span>
          </span>
          {step && (
            <span className="flex-none font-mono font-semibold tabular-nums" aria-hidden="true">
              {step.n}
              <span className="text-ink-muted"> of {step.of}</span>
            </span>
          )}
        </div>
        {step ? (
          <>
            <p className="sr-only">{`Step ${step.n} of ${step.of}`}</p>
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${step.of}, minmax(0, 1fr))` }}
              aria-hidden="true"
            >
              {Array.from({ length: step.of }, (_, i) => (
                <span key={i} className={cx("h-1", i < step.n ? "bg-ink" : "bg-line-strong")} />
              ))}
            </div>
          </>
        ) : (
          <div className="h-px bg-line" aria-hidden="true" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-4.5 px-5 pt-7">{children}</div>
      {actions && <div className="flex flex-col gap-2 px-5 pt-6">{actions}</div>}
      <p className="m-0 px-5 pt-8 pb-8 text-body-s text-ink-muted">
        {club ? `Questions? Ask ${club}.` : "Questions? Ask the club that sent you this link."}
      </p>
    </>
  );
}

/** The screen's one heading: title-guardian, sentence case, never caps. */
export function GuardianTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="m-0 text-title-guardian text-balance break-words stretch-semi">{children}</h1>
  );
}

/** Guardian body copy, 18px; `muted` for the quieter second line. */
export function GuardianText({ muted, children }: { muted?: boolean; children: ReactNode }) {
  return (
    <p className={cx("m-0 text-body-guardian text-pretty", muted && "text-ink-muted")}>
      {children}
    </p>
  );
}

/** A line with an icon in front: what scouts can see, what happens if you stop. */
export function GuardianPoint({
  icon: Icon,
  tone = "text-ink-muted",
  children,
}: {
  icon: LucideIcon;
  /** The icon's colour role. */
  tone?: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3 py-2.5 text-body-guardian">
      <Icon {...iconProps} className={cx("mt-1 flex-none", tone)} />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/**
 * One answer to the question: a full sentence on a 64px button that submits the form
 * with its value. Both answers look the same, so neither one pushes the guardian.
 */
export function AnswerButton({
  name,
  value,
  icon: Icon,
  tone,
  hint,
  children,
}: {
  name: string;
  value: string;
  icon: LucideIcon;
  tone: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className="flex min-h-16 w-full cursor-pointer items-center gap-3.5 rounded-control border-2 border-ink bg-panel px-4.5 py-3 text-left text-ink transition-colors duration-fast hover:bg-raised active:bg-selected"
    >
      <Icon {...iconProps} size={26} className={cx("flex-none", tone)} />
      <span className="min-w-0">
        <span className="block break-words text-body-guardian font-semibold leading-tight">
          {children}
        </span>
        {hint && <span className="mt-1 block text-body-s text-ink-muted">{hint}</span>}
      </span>
    </button>
  );
}

/** Label and value rows under an ink rule: the confirmation facts. */
export function GuardianFacts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="m-0 border-t border-ink">
      {items.map(([label, value]) => (
        <div
          key={label}
          className="flex justify-between gap-3 border-b border-line py-3.5 text-body-guardian"
        >
          <dt className="text-ink-muted">{label}</dt>
          <dd className="m-0 text-right font-semibold break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The 44px text link under the main button ("Go back", "Read the full privacy notice"). */
export const guardianLinkClass =
  "flex min-h-control-l items-center justify-center font-medium text-brand-text";
