import { Check } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { SubmitButton } from "@/components/forms";
import { Button } from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icons";

/**
 * One decision per screen, for guardians on a phone (docs/build/design/D02.md, Surface 5;
 * C05 consent). A plain form, so it works without JavaScript. Choices are DecisionChoice
 * radio cards inside one fieldset.
 */
export function DecisionFlow({
  step,
  question,
  explainer,
  action,
  submitLabel,
  pendingLabel,
  secondary,
  error,
  children,
}: {
  /** "Step 1 of 2". */
  step?: string;
  question: string;
  explainer?: ReactNode;
  action: string | ((formData: FormData) => void | Promise<void>);
  submitLabel: string;
  /** With JavaScript, the submit button shows this while a server action runs (C05). */
  pendingLabel?: string;
  secondary?: { href: string; label: string };
  /** A server-side validation error, shown above the submit button (C01 banner). */
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="wl-decision">
      <form action={action}>
        {step && <p className="caption text-ink-muted">{step}</p>}
        <h1 className="heading-1 break-words">{question}</h1>
        {explainer && <p className="body-lg mt-3 text-ink-muted">{explainer}</p>}
        <fieldset className="mt-6 flex flex-col gap-3">
          <legend className="sr-only">{question}</legend>
          {children}
        </fieldset>
        {error && <div className="mt-6">{error}</div>}
        <div className="mt-6 flex flex-col md:flex-row md:items-center md:gap-2">
          {pendingLabel ? (
            <SubmitButton
              variant="primary"
              block
              className="justify-center"
              pendingLabel={pendingLabel}
            >
              {submitLabel}
            </SubmitButton>
          ) : (
            <Button variant="primary" type="submit" block className="justify-center">
              {submitLabel}
            </Button>
          )}
          {secondary && (
            <Link
              href={secondary.href}
              className="wl-btn wl-btn--ghost mt-2 justify-center md:mt-0"
            >
              {secondary.label}
            </Link>
          )}
        </div>
      </form>
    </div>
  );
}

/** One choice: a radio card with a 2px pitch edge, a fill and a Check icon when chosen. */
export function DecisionChoice({
  name,
  value,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="wl-decision__choice body-lg">
      <input type="radio" name={name} value={value} required defaultChecked={defaultChecked} />
      <span className="min-w-0">
        <span className="block break-words">{label}</span>
        {hint && <span className="caption block text-ink-muted">{hint}</span>}
      </span>
      <Check {...iconProps} />
    </label>
  );
}
