"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import {
  fieldError,
  FieldErrorText,
  FormBusy,
  FormErrorBanner,
  SubmitButton,
  SuccessBanner,
  useFocusFirstInvalid,
  useFormAction,
} from "@/components/forms";
import { iconProps } from "@/components/ui/icons";
import type { ActionResult } from "@/lib/action-result";
import { acceptReviewerTermsAction } from "./actions";

/**
 * The terms record on /scout (docs/build/design/C02.md, Terms section): the
 * accepted version, and when it is stale, the new terms and an Accept button.
 */
export function TermsSection({
  current,
  acceptedVersion,
  acceptedOn,
  currentVersion,
  terms,
  termsOpen,
}: {
  current: boolean;
  acceptedVersion: string;
  acceptedOn: string;
  currentVersion: string;
  /** TermsText, for the "Read the terms" disclosure. */
  terms: ReactNode;
  /** TermsText with a top margin, shown open when the version is stale. */
  termsOpen: ReactNode;
}) {
  const { state, formProps } = useFormAction(acceptReviewerTermsAction, null as ActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useFocusFirstInvalid(formRef, state);
  useEffect(() => {
    if (state?.ok) headingRef.current?.focus();
  }, [state]);
  const checkboxError = fieldError(state, "acceptTerms");

  return (
    <section id="terms" aria-labelledby="scout-terms-heading" className="mt-8">
      <h2 id="scout-terms-heading" ref={headingRef} tabIndex={-1} className="heading-2">
        Confidentiality terms
      </h2>
      <div aria-live="polite" className="mt-4 empty:mt-0">
        <SuccessBanner result={state} />
        <FormErrorBanner result={state} />
      </div>
      {current ? (
        <>
          <p className="body mt-4">
            You accepted version {acceptedVersion} on {acceptedOn}.
          </p>
          <details className="mt-3">
            <summary className="wl-btn wl-btn--ghost wl-btn--sm">Read the terms</summary>
            <div className="mt-3">{terms}</div>
          </details>
        </>
      ) : (
        <>
          <div className="wl-banner mt-4" role="status">
            <TriangleAlert {...iconProps} />
            <p className="body">
              The terms have changed. Accept the new version to review matches again.
            </p>
          </div>
          <p className="caption mt-3 text-ink-muted">
            You accepted version {acceptedVersion} on {acceptedOn}.
          </p>
          {termsOpen}
          <form ref={formRef} {...formProps} noValidate className="mt-4 flex flex-col gap-4">
            <FormBusy formRef={formRef} />
            <input type="hidden" name="termsVersion" value={currentVersion} />
            <div className="wl-field">
              <label className="wl-choice wl-choice--top body">
                <input
                  type="checkbox"
                  name="acceptTerms"
                  value="yes"
                  required
                  aria-invalid={checkboxError ? true : undefined}
                  aria-describedby={checkboxError ? "scout-terms-error" : undefined}
                />
                I accept the updated reviewer confidentiality terms.
              </label>
              {checkboxError && <FieldErrorText id="scout-terms-error" message={checkboxError} />}
            </div>
            <div>
              <SubmitButton block pendingLabel="Saving…" className="justify-center">
                Accept the terms
              </SubmitButton>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
