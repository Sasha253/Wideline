"use client";

import { useEffect, useRef } from "react";
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
import type { ActionResult } from "@/lib/action-result";
import { addPlaceholdersAction } from "../actions";

/**
 * Adds an opposition team's shirt numbers (SQUAD07; docs/build/design/C04.md,
 * Surface 4). On success the field clears and keeps focus.
 */
export function PlaceholderForm({ teamId }: { teamId: string }) {
  const { state, formProps } = useFormAction(addPlaceholdersAction, null as ActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useFocusFirstInvalid(formRef, state);
  const okKey = state?.ok ? state.key : undefined;
  useEffect(() => {
    if (!okKey || !inputRef.current) return;
    inputRef.current.value = "";
    inputRef.current.focus();
  }, [okKey]);

  return (
    <form ref={formRef} {...formProps} noValidate className="wl-card mt-4 max-w-xl">
      <FormBusy formRef={formRef} />
      <input type="hidden" name="teamId" value={teamId} />
      <div aria-live="polite" className="mb-4 empty:mb-0">
        <SuccessBanner result={state} />
      </div>
      <div className="wl-inline-form">
        <Field
          label="Shirt numbers"
          hint="Separate with commas, or use a range. For example 1-11, 14."
          error={fieldError(state, "numbers")}
        >
          {(p) => (
            <input
              {...p}
              ref={inputRef}
              name="numbers"
              className="wl-input"
              inputMode="numeric"
              maxLength={200}
            />
          )}
        </Field>
        <SubmitButton block pendingLabel="Adding…" className="justify-center">
          Add players
        </SubmitButton>
      </div>
      <div className="mt-4 empty:mt-0">
        <FormErrorBanner result={state} />
      </div>
    </form>
  );
}
