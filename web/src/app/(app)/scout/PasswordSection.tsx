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
import { setScoutPasswordAction } from "./actions";

/**
 * Sets the first password of a self-registered scout (AUTH09). Registration
 * takes no password, so the account opens only through the emailed link; this
 * section shows until a password exists. Once saved, the form goes and the
 * success banner stays until the next page load.
 */
export function PasswordSection({ email }: { email: string }) {
  const { state, formProps } = useFormAction(setScoutPasswordAction, null as ActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useFocusFirstInvalid(formRef, state);
  useEffect(() => {
    if (state?.ok) headingRef.current?.focus();
  }, [state]);

  return (
    <section aria-labelledby="scout-password-heading" className="mt-8">
      <h2 id="scout-password-heading" ref={headingRef} tabIndex={-1} className="heading-2">
        Set a password
      </h2>
      <div aria-live="polite" className="mt-4 empty:mt-0">
        <SuccessBanner result={state} />
      </div>
      {!state?.ok && (
        <>
          <p className="body mt-2 text-ink-muted">
            You can always sign in with a link we email you. Set a password to sign in with your
            email and password instead.
          </p>
          <form ref={formRef} {...formProps} noValidate className="mt-4 wl-inline-form">
            <FormBusy formRef={formRef} />
            {/* Gives password managers the user name. Not submitted. */}
            <input
              type="email"
              value={email}
              readOnly
              hidden
              autoComplete="username"
              aria-hidden="true"
            />
            <Field
              label="Password"
              hint="At least 12 characters."
              error={fieldError(state, "password")}
            >
              {(p) => (
                <input
                  {...p}
                  type="password"
                  name="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  className="wl-input"
                />
              )}
            </Field>
            <SubmitButton
              variant="secondary"
              block
              pendingLabel="Saving…"
              className="justify-center"
            >
              Set password
            </SubmitButton>
          </form>
        </>
      )}
      <div className="mt-3 empty:mt-0">
        <FormErrorBanner result={state} />
      </div>
    </section>
  );
}
