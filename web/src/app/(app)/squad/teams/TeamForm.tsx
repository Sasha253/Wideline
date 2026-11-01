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
import { AGE_GROUPS, GENDERS } from "@/lib/squad-fields";
import { createTeamAction, updateTeamAction } from "./actions";

type TeamValues = { name: string; ageGroup: string | null; gender: string | null; season: string };

/**
 * The team form (docs/build/design/C04.md, Surface 4). Create asks whose team it
 * is, once: the kind cannot change later. Edit saves in place.
 */
export function TeamForm(
  props:
    | {
        mode: "create";
        defaultKind: "own" | "opposition";
        defaultSeason: string;
        /** Where to go back to after creating (C06: /matches/new). */
        next?: string;
      }
    | { mode: "edit"; teamId: string; initial: TeamValues; isOpposition: boolean },
) {
  const action = props.mode === "create" ? createTeamAction : updateTeamAction;
  const { state, formProps } = useFormAction(action, null as ActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(formRef, state);
  const initial: TeamValues =
    props.mode === "edit"
      ? props.initial
      : { name: "", ageGroup: null, gender: null, season: props.defaultSeason };

  return (
    <form ref={formRef} {...formProps} className="flex flex-col gap-4" noValidate>
      <FormBusy formRef={formRef} />
      {props.mode === "edit" && (
        <>
          <input type="hidden" name="teamId" value={props.teamId} />
          <div aria-live="polite">
            <SuccessBanner result={state} />
          </div>
        </>
      )}
      {props.mode === "create" && props.next && (
        <input type="hidden" name="next" value={props.next} />
      )}
      {props.mode === "create" && (
        <fieldset className="wl-field">
          <legend className="text-label">Whose team is this?</legend>
          <label className="wl-choice">
            <input
              type="radio"
              name="kind"
              value="own"
              defaultChecked={props.defaultKind === "own"}
            />
            Your club&apos;s team
          </label>
          <label className="wl-choice">
            <input
              type="radio"
              name="kind"
              value="opposition"
              defaultChecked={props.defaultKind === "opposition"}
              aria-describedby="team-kind-hint"
            />
            An opposition team
          </label>
          <p id="team-kind-hint" className="wl-field__hint text-body-s">
            Opposition teams hold unnamed players only: a shirt number, no name. This cannot change
            later.
          </p>
        </fieldset>
      )}
      <Field
        label="Team name"
        hint="For example U15 Boys or First team."
        error={fieldError(state, "name")}
      >
        {(p) => (
          <input
            {...p}
            name="name"
            className="wl-input"
            required
            maxLength={80}
            defaultValue={initial.name}
          />
        )}
      </Field>
      <Field label="Age group (optional)" error={fieldError(state, "ageGroup")}>
        {(p) => (
          <input
            {...p}
            name="ageGroup"
            className="wl-input"
            list="age-groups"
            maxLength={20}
            defaultValue={initial.ageGroup ?? ""}
          />
        )}
      </Field>
      <datalist id="age-groups">
        {AGE_GROUPS.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
      <Field
        label="Gender (optional)"
        hint="A label only. It changes nothing else."
        error={fieldError(state, "gender")}
      >
        {(p) => (
          <input
            {...p}
            name="gender"
            className="wl-input"
            list="genders"
            maxLength={20}
            defaultValue={initial.gender ?? ""}
          />
        )}
      </Field>
      <datalist id="genders">
        {GENDERS.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      <Field label="Season" hint="For example 2026 or 2026/27." error={fieldError(state, "season")}>
        {(p) => (
          <input
            {...p}
            name="season"
            className="wl-input"
            inputMode="numeric"
            maxLength={7}
            defaultValue={initial.season}
          />
        )}
      </Field>
      <FormErrorBanner result={state} />
      <div>
        {props.mode === "create" ? (
          <SubmitButton block pendingLabel="Adding" className="justify-center">
            Add team
          </SubmitButton>
        ) : (
          <SubmitButton
            block
            variant={props.isOpposition ? "secondary" : "primary"}
            pendingLabel="Saving"
            className="justify-center"
          >
            Save changes
          </SubmitButton>
        )}
      </div>
    </form>
  );
}
