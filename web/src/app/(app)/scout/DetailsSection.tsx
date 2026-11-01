"use client";

import { LockKeyhole, MailCheck, MailWarning } from "lucide-react";
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
import { iconProps } from "@/components/ui/icons";
import type { ActionResult } from "@/lib/action-result";
import { updateScoutPhoneAction } from "./actions";

/** Name, email, identity document and the editable phone (docs/build/design/C02.md, Details). */
export function DetailsSection({
  name,
  email,
  emailVerified,
  identity,
  registered,
  phone,
}: {
  name: string;
  email: string;
  emailVerified: boolean;
  /** "South African ID" or "Passport · issued by United Kingdom". Never the number. */
  identity: string;
  registered: string;
  phone: string;
}) {
  const { state, formProps } = useFormAction(updateScoutPhoneAction, null as ActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useFocusFirstInvalid(formRef, state);
  useEffect(() => {
    if (state?.ok) headingRef.current?.focus();
  }, [state]);

  return (
    <section aria-labelledby="scout-details-heading" className="mt-8">
      <h2
        id="scout-details-heading"
        ref={headingRef}
        tabIndex={-1}
        className="m-0 font-display text-heading-section uppercase stretch-wide"
      >
        Your details
      </h2>
      <div aria-live="polite" className="mt-4 empty:mt-0">
        <SuccessBanner result={state} />
      </div>
      <dl className="wl-card mt-4 grid grid-cols-1 gap-x-6 gap-y-3 tablet:grid-cols-[auto_1fr]">
        <dt className="text-label text-ink-muted">Name</dt>
        <dd className="font-semibold break-words">{name}</dd>
        <dt className="text-label text-ink-muted">Email</dt>
        <dd>
          <span className="block break-all">{email}</span>
          {emailVerified ? (
            <span className="wl-inline-status wl-inline-status--ok text-body-s">
              <MailCheck {...iconProps} />
              Confirmed
            </span>
          ) : (
            <span className="wl-inline-status wl-inline-status--warn text-body-s">
              <MailWarning {...iconProps} />
              Not confirmed
            </span>
          )}
        </dd>
        <dt className="text-label text-ink-muted">Identity document</dt>
        <dd>
          <span className="block">{identity}</span>
          <span className="wl-inline-status wl-inline-status--muted text-body-s">
            <LockKeyhole {...iconProps} />
            Number stored as a check value only.
          </span>
        </dd>
        <dt className="text-label text-ink-muted">Registered</dt>
        <dd className="font-mono tabular-nums">{registered}</dd>
      </dl>
      <p className="text-body-s mt-2 text-ink-muted">
        Your name and identity document cannot be changed here.
      </p>

      <form ref={formRef} {...formProps} noValidate className="mt-6 wl-inline-form">
        <FormBusy formRef={formRef} />
        <Field
          label="Mobile number"
          hint="South African numbers can start with 0, for example 082 123 4567. Other numbers start with + and the country code."
          error={fieldError(state, "phone")}
        >
          {(p) => (
            <input
              {...p}
              type="tel"
              name="phone"
              required
              autoComplete="tel"
              inputMode="tel"
              defaultValue={phone}
              className="wl-input"
            />
          )}
        </Field>
        <SubmitButton variant="secondary" block pendingLabel="Saving…" className="justify-center">
          Save number
        </SubmitButton>
      </form>
      <div className="mt-3 empty:mt-0">
        <FormErrorBanner result={state} />
      </div>
    </section>
  );
}
