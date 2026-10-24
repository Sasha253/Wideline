"use client";

import { useId, type ReactNode } from "react";
import { FieldErrorText } from "@/components/forms";

/**
 * A radio group for the club consent forms (docs/build/design/C05.md, Surface 2,
 * "Errors on radio groups"): a fieldset with a visible legend, an optional hint,
 * wl-choice radios in a .wl-choice-row, and the field error under the legend.
 * The fieldset is described by the hint and the error and carries data-invalid,
 * so useFocusFirstInvalid lands on its first radio. Radios take no aria-invalid
 * (the radio role does not support it; jsx-a11y). Nothing is checked unless
 * `defaultValue` says so: consent is never pre-chosen.
 */
export function RadioGroup({
  name,
  legend,
  hint,
  options,
  error,
  defaultValue,
}: {
  name: string;
  legend: ReactNode;
  hint?: ReactNode;
  options: readonly { value: string; label: ReactNode }[];
  error?: string;
  defaultValue?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");
  return (
    <fieldset
      className="wl-field"
      aria-describedby={describedBy || undefined}
      data-invalid={error ? "true" : undefined}
    >
      <legend className="label">{legend}</legend>
      {hint && (
        <p id={hintId} className="caption text-ink-muted">
          {hint}
        </p>
      )}
      {error && <FieldErrorText id={errorId} message={error} />}
      <div className="wl-choice-row">
        {options.map((o) => (
          <label key={o.value} className="wl-choice body">
            <input
              type="radio"
              name={name}
              value={o.value}
              defaultChecked={defaultValue === o.value}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
