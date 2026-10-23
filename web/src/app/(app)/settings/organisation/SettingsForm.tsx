"use client";

import { useRef } from "react";
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
import type { OrganisationType } from "@/generated/prisma/enums";
import { ORG_TYPE_LABELS, SELECTABLE_ORG_TYPES } from "@/lib/labels";
import { saveOrganisationSettings } from "./actions";

export function SettingsForm({
  initial,
  countries,
  provinces,
}: {
  initial: { name: string; type: OrganisationType; country: string; region: string | null };
  countries: { code: string; name: string }[];
  provinces: string[];
}) {
  const { state, formProps } = useFormAction(saveOrganisationSettings, null as ActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(formRef, state);

  return (
    <form ref={formRef} {...formProps} className="flex flex-col gap-4" noValidate>
      <FormBusy formRef={formRef} />
      <div aria-live="polite">
        <SuccessBanner result={state} />
      </div>
      <Field label="Organisation name" error={fieldError(state, "name")}>
        {(p) => (
          <input
            {...p}
            name="name"
            className="wl-input"
            required
            maxLength={120}
            defaultValue={initial.name}
          />
        )}
      </Field>

      {initial.type === "platform" ? (
        <div className="wl-field">
          <p className="label">Type</p>
          <p className="body">{ORG_TYPE_LABELS.platform}</p>
          <p className="wl-field__hint caption">
            The platform organisation&apos;s type cannot change.
          </p>
        </div>
      ) : (
        <fieldset className="wl-field">
          <legend className="label">Type</legend>
          {SELECTABLE_ORG_TYPES.map((t) => (
            <label key={t} className="wl-choice body">
              <input type="radio" name="type" value={t} defaultChecked={initial.type === t} />
              {ORG_TYPE_LABELS[t]}
            </label>
          ))}
        </fieldset>
      )}

      <Field label="Country" error={fieldError(state, "country")}>
        {(p) => (
          <select {...p} name="country" className="wl-input" defaultValue={initial.country}>
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
            className="wl-input"
            list="sa-provinces"
            maxLength={80}
            defaultValue={initial.region ?? ""}
          />
        )}
      </Field>
      <datalist id="sa-provinces">
        {provinces.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      <FormErrorBanner result={state} />
      <div>
        <SubmitButton block pendingLabel="Saving…" className="justify-center">
          Save changes
        </SubmitButton>
      </div>
    </form>
  );
}
