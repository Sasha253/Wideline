import { Check } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { SubmitButton } from "@/components/forms";
import { Button } from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icons";

/**
 * One decision per screen, for guardians on a phone (Floodlight, "Guardian consent"). A
 * plain form, so it works without JavaScript. The title is title-guardian (sentence case,
 * 112.5% wide), the explainer body-guardian. Choices are DecisionChoice radio cards, 64px,
 * inside one fieldset; the chosen one is ink (selection is never lime).
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
        {step && <p className="wl-decision__step m-0">{step}</p>}
        <h1 className="wl-decision__title">{question}</h1>
        {explainer && <p className="wl-decision__explainer">{explainer}</p>}
        <fieldset className="mt-6 flex flex-col gap-3">
          <legend className="sr-only">{question}</legend>
          {children}
        </fieldset>
        {error && <div className="mt-6">{error}</div>}
        <div className="mt-6 flex flex-col tablet:flex-row tablet:items-center tablet:gap-2">
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
              className="wl-btn wl-btn--ghost mt-2 justify-center tablet:mt-0"
            >
              {secondary.label}
            </Link>
          )}
        </div>
      </form>
    </div>
  );
}

/** One choice: a 64px radio card; chosen, it has an ink edge, the selected fill and a Check. */
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
    <label className="wl-decision__choice">
      <input type="radio" name={name} value={value} required defaultChecked={defaultChecked} />
      <span className="min-w-0">
        <span className="block break-words">{label}</span>
        {hint && <span className="wl-decision__hint">{hint}</span>}
      </span>
      <Check {...iconProps} />
    </label>
  );
}
