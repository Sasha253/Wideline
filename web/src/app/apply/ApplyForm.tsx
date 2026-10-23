"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  Field,
  fieldError,
  FieldErrorText,
  FormBusy,
  FormErrorBanner,
  SubmitButton,
  useFocusFirstInvalid,
  useFormAction,
} from "@/components/forms";
import type { ActionResult } from "@/lib/action-result";
import { ButtonLink } from "@/components/ui/Button";
import { ORG_TYPE_LABELS, SELECTABLE_ORG_TYPES } from "@/lib/labels";
import { applyForOrganisation } from "./actions";

export function ApplyForm({
  countries,
  provinces,
}: {
  countries: { code: string; name: string }[];
  provinces: string[];
}) {
  const { state, formProps } = useFormAction(applyForOrganisation, null as ActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  const sentRef = useRef<HTMLHeadingElement>(null);
  useFocusFirstInvalid(formRef, state);
  useEffect(() => {
    if (state?.ok) sentRef.current?.focus();
  }, [state]);

  if (state?.ok) {
    return (
      <>
        <h1 ref={sentRef} tabIndex={-1} className="heading-2 mt-6">
          Application sent
        </h1>
        <p className="body-lg mt-2 text-ink-muted">
          Thanks. We will email you when your organisation is approved.
        </p>
        <div className="mt-6">
          <ButtonLink href="/login" variant="secondary">
            Back to sign in
          </ButtonLink>
        </div>
      </>
    );
  }

  const typeError = fieldError(state, "type");

  return (
    <>
      <h1 className="heading-2 mt-6">Join the pilot</h1>
      <p className="body mt-1 text-ink-muted">
        Wideline is free for invited academies and clubs during the pilot. Tell us about your
        organisation and we will email you when it is approved.
      </p>
      <form ref={formRef} {...formProps} noValidate className="mt-6 flex flex-col gap-6">
        <FormBusy formRef={formRef} />
        <fieldset className="flex flex-col gap-4">
          <legend className="body-strong mb-4">Your organisation</legend>
          <Field label="Organisation name" error={fieldError(state, "name")}>
            {(p) => (
              <input
                {...p}
                name="name"
                required
                maxLength={120}
                autoComplete="organization"
                className="wl-input"
              />
            )}
          </Field>
          <fieldset
            className="wl-field"
            aria-describedby={typeError ? "apply-type-error" : undefined}
            data-invalid={typeError ? "true" : undefined}
          >
            <legend className="label">Type</legend>
            {SELECTABLE_ORG_TYPES.map((t) => (
              <label key={t} className="wl-choice body">
                <input type="radio" name="type" value={t} required />
                {ORG_TYPE_LABELS[t]}
              </label>
            ))}
            {typeError && <FieldErrorText id="apply-type-error" message={typeError} />}
          </fieldset>
          <Field label="Country" error={fieldError(state, "country")}>
            {(p) => (
              <select {...p} name="country" defaultValue="ZA" className="wl-input">
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label="Province or region (optional)"
            hint="For example Gauteng."
            error={fieldError(state, "region")}
          >
            {(p) => (
              <input {...p} name="region" list="sa-provinces" maxLength={80} className="wl-input" />
            )}
          </Field>
          <datalist id="sa-provinces">
            {provinces.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="body-strong mb-4">About you</legend>
          <Field label="Your name" error={fieldError(state, "applicantName")}>
            {(p) => (
              <input
                {...p}
                name="applicantName"
                required
                maxLength={120}
                autoComplete="name"
                className="wl-input"
              />
            )}
          </Field>
          <Field
            label="Your email"
            hint="We send the decision and your invitation here."
            error={fieldError(state, "applicantEmail")}
          >
            {(p) => (
              <input
                {...p}
                type="email"
                name="applicantEmail"
                required
                autoComplete="email"
                className="wl-input"
              />
            )}
          </Field>
        </fieldset>

        {/* Honeypot: hidden from people and screen readers; bots fill it in. */}
        <div className="sr-only" aria-hidden="true">
          <label htmlFor="apply-website">Leave this empty</label>
          <input id="apply-website" name="website" tabIndex={-1} autoComplete="off" />
        </div>

        <FormErrorBanner result={state} />
        <SubmitButton block pendingLabel="Sending…" className="justify-center">
          Send application
        </SubmitButton>
      </form>
      <p className="caption mt-6">
        Already have an account?{" "}
        <Link href="/login" className="text-pitch underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
