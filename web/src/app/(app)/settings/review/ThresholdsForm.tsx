"use client";

import { TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import {
  fieldError,
  FormBusy,
  FormErrorBanner,
  SubmitButton,
  SuccessBanner,
  useFocusFirstInvalid,
  useFormAction,
} from "@/components/forms";
import { ICON_SIZE_DENSE, iconProps } from "@/components/ui/icons";
import { TextField } from "@/components/ui/TextField";
import type { ActionResult } from "@/lib/action-result";
import {
  AUTO_ACCEPT_DEFAULTS,
  AUTO_ACCEPT_TYPES,
  formatThreshold,
  THRESHOLD_LABELS,
  type AutoAcceptType,
} from "@/lib/auto-accept";
import { saveThresholdsAction } from "./actions";

const PLURAL: Record<AutoAcceptType, string> = { goal: "goals", shot: "shots", touch: "touches" };

/** Below this, a warning says most events of the type skip review. */
const LOW_THRESHOLD = 0.5;

/**
 * The auto-accept thresholds form (docs/build/design/C11.md, Surface 6; the
 * C01 SettingsForm pattern). Scores from 0.00 to 1.00, as the review meter
 * shows them (Q-072).
 */
export function ThresholdsForm({ initial }: { initial: Record<AutoAcceptType, string> }) {
  const { state, formProps } = useFormAction(saveThresholdsAction, null as ActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(formRef, state);
  const [values, setValues] = useState(initial);

  return (
    <form ref={formRef} {...formProps} className="mt-3 flex flex-col gap-5" noValidate>
      <FormBusy formRef={formRef} />
      <div aria-live="polite" className="empty:hidden">
        <SuccessBanner result={state} />
      </div>
      {AUTO_ACCEPT_TYPES.map((t) => {
        const n = Number(values[t]);
        const low = values[t].trim() !== "" && Number.isFinite(n) && n >= 0 && n < LOW_THRESHOLD;
        return (
          <TextField
            key={t}
            label={THRESHOLD_LABELS[t]}
            name={t}
            mono
            inputMode="decimal"
            autoComplete="off"
            value={values[t]}
            onChange={(e) => setValues((v) => ({ ...v, [t]: e.target.value }))}
            // The input is 96px wide; the help line keeps the field's full width.
            className="[&_.wl-control]:w-24"
            help={
              <span className="flex flex-col gap-1">
                <span>Default {formatThreshold(AUTO_ACCEPT_DEFAULTS[t])}</span>
                {low && (
                  <span className="wl-inline-status wl-inline-status--warn flex">
                    <TriangleAlert {...iconProps} size={ICON_SIZE_DENSE} />
                    At {values[t].trim()}, most {PLURAL[t]} are accepted without a scout checking
                    them.
                  </span>
                )}
              </span>
            }
            error={fieldError(state, t)}
          />
        );
      })}
      <p className="m-0 text-body-s text-ink-muted">
        Changes apply to matches processed from now on. Matches already processed keep their events
        as they are.
      </p>
      <FormErrorBanner result={state} />
      <div>
        <SubmitButton block pendingLabel="Saving…">
          Save thresholds
        </SubmitButton>
      </div>
    </form>
  );
}
