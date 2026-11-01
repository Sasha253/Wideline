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
import { addPlaceholderAction } from "./actions";

/**
 * Adds the shirt numbers the opposition wore, as unnamed placeholders (SQUAD07;
 * docs/build/design/C06.md, Surface 4). The C04 placeholder pattern, posting
 * to the lineup page's own action. On success the field clears and keeps focus.
 */
export function OppositionNumbers({ matchId, teamId }: { matchId: string; teamId: string }) {
  const { state, formProps } = useFormAction(addPlaceholderAction, null as ActionResult);
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
    <form
      ref={formRef}
      {...formProps}
      noValidate
      className="mt-6 max-w-4xl border border-line bg-panel p-4"
    >
      <FormBusy formRef={formRef} />
      <input type="hidden" name="matchId" value={matchId} />
      <input type="hidden" name="teamId" value={teamId} />
      <div aria-live="polite" className="mb-4 empty:mb-0">
        <SuccessBanner result={state} />
      </div>
      <div className="wl-inline-form">
        <Field
          label="Add shirt numbers"
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
        <SubmitButton variant="secondary" block pendingLabel="Adding…" className="justify-center">
          Add players
        </SubmitButton>
      </div>
      <div className="mt-4 empty:mt-0">
        <FormErrorBanner result={state} />
      </div>
    </form>
  );
}
