"use client";

import { useRef } from "react";
import {
  fieldError,
  FormBusy,
  FormErrorBanner,
  SubmitButton,
  SuccessBanner,
  useFocusFirstInvalid,
  useFormAction,
} from "@/components/forms";
import { FieldMessage, Select, TextField } from "@/components/ui/TextField";
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
    <form ref={formRef} {...formProps} className="flex flex-col gap-5" noValidate>
      <FormBusy formRef={formRef} />
      <div aria-live="polite" className="empty:hidden">
        <SuccessBanner result={state} />
      </div>
      <TextField
        label="Organisation name"
        name="name"
        required
        maxLength={120}
        defaultValue={initial.name}
        error={fieldError(state, "name")}
      />

      {initial.type === "platform" ? (
        <div className="wl-field">
          <p className="wl-field__label m-0">Type</p>
          <p className="m-0">{ORG_TYPE_LABELS.platform}</p>
          <FieldMessage>The platform organisation&apos;s type cannot change.</FieldMessage>
        </div>
      ) : (
        <fieldset className="wl-field m-0 border-0 p-0">
          <legend className="wl-field__label">Type</legend>
          <div className="flex flex-col gap-1">
            {SELECTABLE_ORG_TYPES.map((t) => (
              <label key={t} className="wl-choice">
                <input type="radio" name="type" value={t} defaultChecked={initial.type === t} />
                {ORG_TYPE_LABELS[t]}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <Select
        label="Country"
        name="country"
        defaultValue={initial.country}
        options={countries.map((c) => ({ value: c.code, label: c.name }))}
        error={fieldError(state, "country")}
      />

      <TextField
        label="Province or region (optional)"
        name="region"
        list="sa-provinces"
        maxLength={80}
        defaultValue={initial.region ?? ""}
        help="For example Gauteng."
        error={fieldError(state, "region")}
      />
      <datalist id="sa-provinces">
        {provinces.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      <FormErrorBanner result={state} />
      <div>
        <SubmitButton block pendingLabel="Saving…">
          Save changes
        </SubmitButton>
      </div>
    </form>
  );
}
