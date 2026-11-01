"use client";

import { Clock } from "lucide-react";
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
import { StatusChip } from "@/components/ui/StatusChip";
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
        <span className="mt-12 self-start">
          <StatusChip tone="warn" icon={Clock} label="Waiting for review" />
        </span>
        <h1 ref={sentRef} tabIndex={-1} className="m-0 mt-4.5 text-title-guardian stretch-semi">
          Application sent
        </h1>
        <p className="m-0 mt-4.5 text-body-guardian text-pretty">
          Thanks. We will email you when your organisation is approved.
        </p>
        <div className="mt-8">
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
      <h1 className="m-0 mt-10 text-title-guardian stretch-semi">Join the pilot</h1>
      <p className="m-0 mt-3 text-body-guardian text-pretty text-ink-muted">
        Wideline is free for invited academies and clubs during the pilot. Tell us about your
        organisation and we will email you when it is approved.
      </p>
      <form ref={formRef} {...formProps} noValidate className="mt-8 flex flex-col gap-8">
        <FormBusy formRef={formRef} />
        <fieldset className="m-0 flex flex-col gap-4 border-0 p-0">
          <legend className="mb-4 font-display text-heading-section uppercase stretch-wide">
            Your organisation
          </legend>
          <Field label="Organisation name" error={fieldError(state, "name")}>
            {(p) => (
              <input
                {...p}
                name="name"
                required
                maxLength={120}
                autoComplete="organization"
                className="wl-input h-12 tablet:h-10"
              />
            )}
          </Field>
          <fieldset
            className="wl-field m-0 border-0 p-0"
            aria-describedby={typeError ? "apply-type-error" : undefined}
            data-invalid={typeError ? "true" : undefined}
          >
            <legend className="wl-field__label mb-1.5">Type</legend>
            {SELECTABLE_ORG_TYPES.map((t) => (
              <label key={t} className="wl-choice min-h-control-l tablet:min-h-control-m">
                <input type="radio" name="type" value={t} required />
                {ORG_TYPE_LABELS[t]}
              </label>
            ))}
            {typeError && <FieldErrorText id="apply-type-error" message={typeError} />}
          </fieldset>
          <Field label="Country" error={fieldError(state, "country")}>
            {(p) => (
              <select {...p} name="country" defaultValue="ZA" className="wl-input h-12 tablet:h-10">
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
              <input
                {...p}
                name="region"
                list="sa-provinces"
                maxLength={80}
                className="wl-input h-12 tablet:h-10"
              />
            )}
          </Field>
          <datalist id="sa-provinces">
            {provinces.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </fieldset>

        <fieldset className="m-0 flex flex-col gap-4 border-0 p-0">
          <legend className="mb-4 font-display text-heading-section uppercase stretch-wide">
            About you
          </legend>
          <Field label="Your name" error={fieldError(state, "applicantName")}>
            {(p) => (
              <input
                {...p}
                name="applicantName"
                required
                maxLength={120}
                autoComplete="name"
                className="wl-input h-12 tablet:h-10"
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
                className="wl-input h-12 tablet:h-10"
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
        <SubmitButton size="xl" block pendingLabel="Sending" className="justify-center">
          Send application
        </SubmitButton>
      </form>
      <p className="m-0 mt-8 text-body-s text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-brand-text">
          Sign in
        </Link>
      </p>
    </>
  );
}
