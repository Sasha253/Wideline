"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import {
  Field,
  fieldError,
  FormBusy,
  FormErrorBanner,
  SubmitButton,
  SuccessBanner,
  useFocusFirstInvalid,
  useFormAction,
} from "@/components/forms";
import { iconProps } from "@/components/ui/icons";
import { FlagStateChip } from "@/components/ui/StatusChip";
import type { ActionResult } from "@/lib/action-result";
import { setFeatureFlagAction } from "./actions";

export type FlagItem = {
  key: string;
  label: string;
  description: string;
  release: string;
  /** The effective value and where it came from ("From a flag"). */
  on: boolean;
  source: string;
  /** The plan's value (or the built-in default), for "Plan default (Off)". */
  planOn: boolean;
  /** The stored flag row: on, off, invalid (ignored), or none. */
  flag: "on" | "off" | "invalid" | null;
  /** "Set on 24 Oct 2026 by Lab Admin." when a flag row exists. */
  setText: string | null;
  reason: string | null;
};

const REASON_HINT = "Kept in the audit log. Say who asked and why.";

/** One feature: what it is, its effective state, and the plan default / on / off form. */
function FlagCard({ organisationId, item }: { organisationId: string; item: FlagItem }) {
  const { state, formProps } = useFormAction(setFeatureFlagAction, null as ActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  useFocusFirstInvalid(formRef, state);
  // Focus stays on Save after a save (the button was disabled while pending).
  useEffect(() => {
    if (state?.ok) saveRef.current?.focus();
  }, [state]);
  const checked = item.flag === "on" || item.flag === "off" ? item.flag : "default";
  const choices: [string, string][] = [
    ["default", `Plan default (${item.planOn ? "On" : "Off"})`],
    ["on", "On"],
    ["off", "Off"],
  ];

  return (
    <li className="wl-card wl-setting" aria-labelledby={headingId}>
      <div className="flex flex-col gap-2">
        <h3 id={headingId} className="body-strong">
          {item.label}
        </h3>
        <p className="body text-ink-muted">{item.description}</p>
        <p className="caption text-ink-muted">Release: {item.release}</p>
        <div className="wl-row">
          <FlagStateChip on={item.on} />
          <span className="caption text-ink-muted">{item.source}</span>
        </div>
        {item.flag === "invalid" && (
          <p className="wl-inline-status wl-inline-status--warn caption">
            <TriangleAlert {...iconProps} />
            The stored flag is not valid, so it is ignored. Save a new value or use the plan
            default.
          </p>
        )}
        {item.setText && <p className="caption text-ink-muted">{item.setText}</p>}
        {item.reason && <p className="body break-words">Reason: {item.reason}</p>}
      </div>

      <form ref={formRef} {...formProps} noValidate className="flex flex-col gap-4">
        <FormBusy formRef={formRef} />
        <input type="hidden" name="organisationId" value={organisationId} />
        <input type="hidden" name="key" value={item.key} />
        <div aria-live="polite" className="empty:hidden">
          <SuccessBanner result={state} />
        </div>
        <fieldset className="wl-field">
          <legend className="label">
            Setting<span className="sr-only"> for {item.label}</span>
          </legend>
          <div className="wl-choice-row">
            {choices.map(([value, text]) => (
              <label key={value} className="wl-choice body">
                <input type="radio" name="state" value={value} defaultChecked={value === checked} />
                {text}
              </label>
            ))}
          </div>
        </fieldset>
        <Field
          label={
            <>
              Reason (optional)<span className="sr-only"> for {item.label}</span>
            </>
          }
          hint={REASON_HINT}
          error={fieldError(state, "reason")}
        >
          {(p) => (
            <input {...p} name="reason" maxLength={500} autoComplete="off" className="wl-input" />
          )}
        </Field>
        <FormErrorBanner result={state} />
        <div className="wl-row">
          <SubmitButton
            ref={saveRef}
            variant="secondary"
            block
            pendingLabel="Saving…"
            aria-label={`Save ${item.label}`}
            className="justify-center"
          >
            Save
          </SubmitButton>
        </div>
      </form>
    </li>
  );
}

/** Feature flags for one organisation (ADMIN04; docs/build/design/C03.md, Surface 1). */
export function FlagsSection({
  organisationId,
  items,
}: {
  organisationId: string;
  items: FlagItem[];
}) {
  const headingId = useId();
  const set = items.filter((i) => i.flag !== null).length;
  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h2 id={headingId} className="heading-2">
        Feature flags
      </h2>
      <p className="body mt-2 max-w-prose text-ink-muted">
        Turn a feature on or off for this organisation only. A flag beats the plan and any override.
      </p>
      <p className="caption mt-2 text-ink-muted">
        {set
          ? `${set} of ${items.length} features set by a flag.`
          : "No flags set. Every feature follows the plan."}
      </p>
      <ul role="list" className="mt-4 flex flex-col gap-3">
        {items.map((item) => (
          <FlagCard key={item.key} organisationId={organisationId} item={item} />
        ))}
      </ul>
    </section>
  );
}
