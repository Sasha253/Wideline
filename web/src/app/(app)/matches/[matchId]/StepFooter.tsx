import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { iconProps } from "@/components/ui/icons";

export type StepNext = {
  label: string;
  /** Where the primary goes; null while the step cannot continue (shown aria-disabled). */
  href: string | null;
  /** Why it cannot continue yet, shown beside the button ("Set full time to continue"). */
  reason?: string;
};

/**
 * The sticky step bar under the lineup and marker steps (Screens A, "Upload · lineup" and
 * "Upload · markers"): back to the previous step on the left, a status note and the one
 * primary on the right. It only links: saving stays with each form. Phones can get their
 * own next step (`phoneNext`, "Continue to away lineup"). Below 768px it sits above the
 * shell's tab bar.
 */
export function StepFooter({
  id,
  back,
  note,
  next,
  phoneNext,
}: {
  /** Unique per page: the reason's id for aria-describedby. */
  id: string;
  back: { href: string; label: string };
  note?: ReactNode;
  next: StepNext;
  phoneNext?: StepNext;
}) {
  return (
    <div className="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center gap-3 border-t border-line bg-panel px-7 py-3.5 touch:bottom-[var(--wl-shell-tabbar)] touch:px-4">
      <ButtonLink variant="secondary" icon={ArrowLeft} href={back.href} className="touch:hidden">
        {back.label}
      </ButtonLink>
      <span className="flex-1 touch:hidden" />
      {note && (
        <span className="font-mono text-body-s text-ink-muted tabular-nums touch:w-full touch:text-center">
          {note}
        </span>
      )}
      <NextButton
        id={`${id}-next`}
        step={next}
        className={phoneNext ? "touch:hidden" : "touch:w-full"}
      />
      {phoneNext && (
        <NextButton
          id={`${id}-phone-next`}
          step={phoneNext}
          className="hidden touch:flex touch:w-full"
        />
      )}
    </div>
  );
}

function NextButton({ id, step, className }: { id: string; step: StepNext; className?: string }) {
  const label = (
    <>
      {step.label}
      <ArrowRight {...iconProps} />
    </>
  );
  if (step.href) {
    return (
      <ButtonLink
        variant="primary"
        href={step.href}
        className={cx("justify-center touch:h-control-xl", className)}
      >
        {label}
      </ButtonLink>
    );
  }
  // Disabled, not removed: it stays focusable and names why (Button renders aria-disabled).
  const reasonId = `${id}-reason`;
  return (
    <span
      className={cx(
        "flex items-center gap-3 touch:flex-col touch:items-stretch touch:gap-2",
        className,
      )}
    >
      {step.reason && (
        <span id={reasonId} className="text-ink-muted touch:text-center">
          {step.reason}
        </span>
      )}
      <Button
        variant="primary"
        disabled
        aria-describedby={step.reason ? reasonId : undefined}
        className="justify-center touch:h-control-xl"
      >
        {step.label}
      </Button>
    </span>
  );
}
