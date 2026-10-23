"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  Field,
  fieldError,
  FormBusy,
  FormErrorBanner,
  SubmitButton,
  SuccessBanner,
  useFocusFirstInvalid,
  useFormActionWithAlternate,
} from "@/components/forms";
import { iconProps } from "@/components/ui/icons";
import type { ActionResult } from "@/lib/action-result";
import { clearLimitOverrideAction, setLimitOverrideAction } from "./actions";

export type LimitItem = {
  key: string;
  label: string;
  description: string;
  unit: "count" | "bytes";
  /** limitText of the plan value, and whether it is the built-in default (the plan lacks the key). */
  planText: string;
  planIsDefault: boolean;
  /** limitText of the stored override; null with none; "invalid" when it is ignored. */
  overrideText: string | null | "invalid";
  /** The number input's prefill: the override in its unit (GB for bytes), or "". */
  overrideInput: string;
  overrideUnlimited: boolean;
  hasOverride: boolean;
  /** limitText of the effective value, and its source text. */
  effectiveText: string;
  source: string;
  /** A flag row sets this limit (not through this page), so an override has no effect. */
  flagSet: boolean;
  /** A flag row on this limit holds a value that is not valid, so it is ignored. */
  flagInvalid: boolean;
  setText: string | null;
  reason: string | null;
  /** Changes when the effective value or its source changes, so the value row remounts. */
  valueKey: string;
};

const REASON_HINT = "Kept in the audit log. Say who asked and why.";

/** The new limit and Unlimited. Ticking Unlimited disables the number and keeps its value. */
function ValueRow({
  item,
  headingId,
  error,
}: {
  item: LimitItem;
  headingId: string;
  error?: string;
}) {
  const [unlimited, setUnlimited] = useState(item.overrideUnlimited);
  const bytes = item.unit === "bytes";
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-start md:gap-4">
      <Field
        className="md:flex-1"
        label={
          <>
            {bytes ? "New limit in GB" : "New limit"}
            <span className="sr-only"> for {item.label}</span>
          </>
        }
        hint={`Plan default: ${item.planText}.`}
        error={error}
      >
        {(p) => (
          <input
            {...p}
            type="number"
            name="value"
            inputMode={bytes ? "decimal" : "numeric"}
            min={0}
            step={bytes ? 0.01 : 1}
            defaultValue={item.overrideInput}
            disabled={unlimited}
            className="wl-input"
          />
        )}
      </Field>
      <UnlimitedBox headingId={headingId} checked={unlimited} onChange={setUnlimited} />
    </div>
  );
}

/** Read as "Unlimited, Matches per month": described by the card's h3. */
function UnlimitedBox({
  headingId,
  checked,
  onChange,
}: {
  headingId: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="wl-choice body md:mt-6">
      <input
        type="checkbox"
        name="unlimited"
        value="yes"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        aria-describedby={headingId}
      />
      Unlimited
    </label>
  );
}

/** One limit: plan, override and effective values, and the override form. */
function LimitCard({ organisationId, item }: { organisationId: string; item: LimitItem }) {
  const { state, lastWasAlternate, formProps, alternateAction } = useFormActionWithAlternate(
    setLimitOverrideAction,
    clearLimitOverrideAction,
    null as ActionResult,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  useFocusFirstInvalid(formRef, state);
  // Focus stays on Save after a save, and moves there after a clear, which
  // unmounts Use plan default.
  useEffect(() => {
    if (state?.ok) saveRef.current?.focus();
  }, [state, lastWasAlternate]);

  return (
    <li className="wl-card wl-setting" aria-labelledby={headingId}>
      <div className="flex flex-col gap-3">
        <h3 id={headingId} className="body-strong">
          {item.label}
        </h3>
        <p className="body text-ink-muted">{item.description}</p>
        <dl className="wl-setting__facts">
          <div>
            <dt className="label text-ink-muted">Plan</dt>
            <dd>
              <span className="data block">{item.planText}</span>
              {item.planIsDefault && (
                <span className="caption block text-ink-muted">Built-in default</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="label text-ink-muted">Override</dt>
            <dd>
              {item.overrideText === null ? (
                <span className="body text-ink-muted">None</span>
              ) : item.overrideText === "invalid" ? (
                <span className="body text-ink-muted">Not valid</span>
              ) : (
                <span className="data block">{item.overrideText}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="label text-ink-muted">Now</dt>
            <dd>
              <span className="data block">{item.effectiveText}</span>
              <span className="caption block text-ink-muted">{item.source}</span>
            </dd>
          </div>
        </dl>
        {item.overrideText === "invalid" && (
          <p className="wl-inline-status wl-inline-status--warn caption">
            <TriangleAlert {...iconProps} />
            The stored override is not valid, so it is ignored. Save a new value or use the plan
            default.
          </p>
        )}
        {item.flagInvalid && (
          <p className="wl-inline-status wl-inline-status--warn caption">
            <TriangleAlert {...iconProps} />
            The stored flag is not valid, so it is ignored. Save a new value or use the plan
            default.
          </p>
        )}
        {item.flagSet && (
          <p className="wl-inline-status wl-inline-status--warn caption">
            <TriangleAlert {...iconProps} />A flag sets this limit, so an override has no effect
            while it is set.
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
        <ValueRow
          key={item.valueKey}
          item={item}
          headingId={headingId}
          error={fieldError(state, "value")}
        />
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
        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
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
          {item.hasOverride && (
            <SubmitButton
              variant="ghost"
              block
              pendingLabel="Clearing…"
              aria-label={`Use plan default for ${item.label}`}
              formAction={alternateAction}
              className="justify-center"
            >
              Use plan default
            </SubmitButton>
          )}
        </div>
      </form>
    </li>
  );
}

/** Limit overrides for one organisation (BILL01; docs/build/design/C03.md, Surface 1). */
export function LimitsSection({
  organisationId,
  items,
}: {
  organisationId: string;
  items: LimitItem[];
}) {
  const headingId = useId();
  const overridden = items.filter((i) => i.hasOverride).length;
  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h2 id={headingId} className="heading-2">
        Limits
      </h2>
      <p className="body mt-2 max-w-prose text-ink-muted">
        Raise or lower a limit for this organisation only. Limits are recorded now and enforced once
        paid plans start in v2.
      </p>
      <p className="caption mt-2 text-ink-muted">
        {overridden
          ? `${overridden} of ${items.length} limits overridden.`
          : "No overrides. Every limit follows the plan."}
      </p>
      <ul role="list" className="mt-4 flex flex-col gap-3">
        {items.map((item) => (
          <LimitCard key={item.key} organisationId={organisationId} item={item} />
        ))}
      </ul>
    </section>
  );
}
