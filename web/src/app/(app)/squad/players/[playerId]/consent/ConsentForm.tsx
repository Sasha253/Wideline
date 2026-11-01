"use client";

import Link from "next/link";
import { useRef, type ReactNode } from "react";
import {
  Field,
  FieldErrorText,
  fieldError,
  FormBusy,
  FormErrorBanner,
  SubmitButton,
  useFocusFirstInvalid,
  useFormAction,
} from "@/components/forms";
import { RadioGroup } from "@/components/consent/RadioGroup";
import type { ActionResult } from "@/lib/action-result";
import {
  CLUB_CONSENT_METHODS,
  CONSENT_METHOD_LABELS,
  CONSENT_NAME_MAX,
  GUARDIAN_RELATIONSHIPS,
  RELATIONSHIP_LABELS,
} from "@/lib/consent-rules";
import { recordConsentAction } from "./actions";

/**
 * The club's record of a consent decision (CONS02, NFR09, NFR10;
 * docs/build/design/C05.md, Surface 2). Every radio group starts empty:
 * consent is never pre-chosen. The wording block is rendered on the server and
 * passed in. Success redirects to the player page.
 */
export function ConsentForm({
  playerId,
  firstName,
  name,
  clubName,
  minor,
  today,
  version,
  wording,
}: {
  playerId: string;
  firstName: string;
  name: string;
  clubName: string;
  minor: boolean;
  today: string;
  version: string;
  wording: ReactNode;
}) {
  const { state, formProps } = useFormAction(recordConsentAction, null as ActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(formRef, state);
  const err = (n: string) => fieldError(state, n);
  const seenError = err("seenWording");

  return (
    <form ref={formRef} {...formProps} noValidate className="flex flex-col gap-6">
      <FormBusy formRef={formRef} />
      <input type="hidden" name="playerId" value={playerId} />

      <div className="flex flex-col gap-6">
        <h2 className="font-display text-heading-section uppercase stretch-wide">Who decided</h2>
        {minor ? (
          <>
            <Field
              label="Parent or guardian's full name"
              hint="As it is written on the form, or as they told you."
              error={err("grantedBy")}
            >
              {(p) => (
                <input
                  {...p}
                  name="grantedBy"
                  className="wl-input"
                  autoComplete="off"
                  maxLength={CONSENT_NAME_MAX}
                />
              )}
            </Field>
            <RadioGroup
              name="relationship"
              legend={`How are they related to ${firstName}?`}
              hint={`They must be ${firstName}'s parent, or someone who legally cares for ${firstName}.`}
              options={GUARDIAN_RELATIONSHIPS.map((r) => ({
                value: r,
                label: RELATIONSHIP_LABELS[r],
              }))}
              error={err("relationship")}
            />
          </>
        ) : (
          <>
            <p>The player decides: {name}.</p>
            <input type="hidden" name="relationship" value="self" />
            {err("relationship") && <FieldErrorText message={err("relationship")!} />}
          </>
        )}
      </div>

      <div className="flex flex-col gap-6 border-t border-line pt-6">
        <h2 className="font-display text-heading-section uppercase stretch-wide mt-2">
          How and when
        </h2>
        <RadioGroup
          name="method"
          legend="How did they give their answer?"
          options={CLUB_CONSENT_METHODS.map((m) => ({ value: m, label: CONSENT_METHOD_LABELS[m] }))}
          error={err("method")}
        />
        <Field
          label="Date of the decision"
          hint="The day they signed, or told you."
          error={err("grantedAt")}
          className="max-w-xs"
        >
          {(p) => (
            <input
              {...p}
              type="date"
              name="grantedAt"
              className="wl-input"
              max={today}
              defaultValue={today}
            />
          )}
        </Field>
      </div>

      <div className="flex flex-col gap-6 border-t border-line pt-6">
        <h2 className="font-display text-heading-section uppercase stretch-wide mt-2">
          What they chose
        </h2>
        <div>
          <p className="text-label">What they were shown</p>
          <div className="mt-2 rounded-control bg-sunken p-4">{wording}</div>
          <Link
            href={`/squad/players/${playerId}/consent/print`}
            className="mt-2 inline-block text-brand-text underline"
          >
            Print the paper form
          </Link>
        </div>
        <RadioGroup
          name="clubStats"
          legend={`Can ${clubName} record ${firstName}'s stats?`}
          options={[
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ]}
          error={err("clubStats")}
        />
        <RadioGroup
          name="scoutVisible"
          legend={`Can scouts see ${firstName}'s stats?`}
          hint="Only possible if the club can record them."
          options={[
            { value: "yes", label: "Yes, scouts can see them" },
            { value: "no", label: "No, keep them inside the club" },
          ]}
          error={err("scoutVisible")}
        />
        <div className="wl-field">
          <label className="wl-choice wl-choice--top">
            <input
              type="checkbox"
              name="seenWording"
              aria-invalid={seenError ? true : undefined}
              aria-describedby={seenError ? `consent-seen-error-${playerId}` : undefined}
            />
            <span>
              The person deciding saw this wording (version{" "}
              <span className="font-mono text-mono-m tabular-nums">{version}</span>
              ).
            </span>
          </label>
          {seenError && (
            <FieldErrorText id={`consent-seen-error-${playerId}`} message={seenError} />
          )}
        </div>
      </div>

      <FormErrorBanner result={state} />
      <div>
        <SubmitButton variant="primary" block pendingLabel="Saving" className="justify-center">
          Save consent
        </SubmitButton>
      </div>
    </form>
  );
}
