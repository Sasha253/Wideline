"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  Banner,
  Field,
  fieldError,
  FormBusy,
  FormErrorBanner,
  SubmitButton,
  SuccessBanner,
  useFocusFirstInvalid,
  useFormAction,
} from "@/components/forms";
import type { PreferredFoot } from "@/generated/prisma/enums";
import type { ActionResult } from "@/lib/action-result";
import { FOOT_LABELS } from "@/lib/labels";
import { POSITIONS } from "@/lib/squad-fields";
import { createPlayerAction, updatePlayerAction } from "./actions";
import type { PlayerFormValues } from "./form-values";

/**
 * The player form (SQUAD02; docs/build/design/C04.md, Surface 5). Its field
 * errors come from the same row validator as the CSV import. Create stays on
 * the page after a success, keeps the team and clears the rest for the next
 * player; edit saves in place.
 */
export function PlayerForm({
  mode,
  playerId,
  initial,
  teams,
  today,
}: {
  mode: "create" | "edit";
  playerId?: string;
  initial: PlayerFormValues;
  /** Own teams, as "U15 Boys (2026)", season newest first. */
  teams: { id: string; label: string }[];
  /** YYYY-MM-DD in South Africa: the date input's max. */
  today: string;
}) {
  const action = mode === "create" ? createPlayerAction : updatePlayerAction;
  const { state, formProps } = useFormAction(action, null as ActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(formRef, state);

  // Create: after a success, clear every field but Team and start again at First name.
  const okKey = mode === "create" && state?.ok ? state.key : undefined;
  useEffect(() => {
    const form = formRef.current;
    if (!okKey || !form) return;
    const team = form.elements.namedItem("teamId") as HTMLSelectElement | null;
    const teamValue = team?.value ?? "";
    form.reset();
    if (team) team.value = teamValue;
    (form.elements.namedItem("firstName") as HTMLInputElement | null)?.focus();
  }, [okKey]);

  const form = (
    <form ref={formRef} {...formProps} className="wl-form-grid" noValidate>
      <FormBusy formRef={formRef} />
      {mode === "edit" && <input type="hidden" name="playerId" value={playerId} />}
      <Field label="First name" error={fieldError(state, "firstName")}>
        {(p) => (
          <input
            {...p}
            name="firstName"
            className="wl-input"
            autoComplete="off"
            maxLength={60}
            required
            defaultValue={initial.firstName}
          />
        )}
      </Field>
      <Field label="Last name" error={fieldError(state, "lastName")}>
        {(p) => (
          <input
            {...p}
            name="lastName"
            className="wl-input"
            autoComplete="off"
            maxLength={60}
            required
            defaultValue={initial.lastName}
          />
        )}
      </Field>
      <Field
        label="Date of birth"
        hint="We use this to know when a guardian must give consent."
        error={fieldError(state, "dateOfBirth")}
      >
        {(p) => (
          <input
            {...p}
            type="date"
            name="dateOfBirth"
            className="wl-input"
            max={today}
            required
            defaultValue={initial.dateOfBirth}
          />
        )}
      </Field>
      <Field label="Preferred foot (optional)" error={fieldError(state, "preferredFoot")}>
        {(p) => (
          <select
            {...p}
            name="preferredFoot"
            className="wl-input"
            defaultValue={initial.preferredFoot}
          >
            <option value="">Not set</option>
            {(Object.keys(FOOT_LABELS) as PreferredFoot[]).map((f) => (
              <option key={f} value={f}>
                {FOOT_LABELS[f]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Position (optional)" error={fieldError(state, "position")}>
        {(p) => (
          <select {...p} name="position" className="wl-input" defaultValue={initial.position}>
            <option value="">Not set</option>
            {POSITIONS.map((pos) => (
              <option key={pos.code} value={pos.code}>
                {pos.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Height in cm (optional)" error={fieldError(state, "heightCm")}>
        {(p) => (
          <input
            {...p}
            name="heightCm"
            className="wl-input"
            inputMode="numeric"
            maxLength={3}
            defaultValue={initial.heightCm}
          />
        )}
      </Field>
      <Field label="Team" hint="Needed for a squad number." error={fieldError(state, "teamId")}>
        {(p) => (
          <select {...p} name="teamId" className="wl-input" defaultValue={initial.teamId}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
            <option value="">No team</option>
          </select>
        )}
      </Field>
      <Field
        label="Squad number (optional)"
        hint="1 to 99. Each number is used once per team."
        error={fieldError(state, "squadNumber")}
      >
        {(p) => (
          <input
            {...p}
            name="squadNumber"
            className="wl-input"
            inputMode="numeric"
            maxLength={2}
            defaultValue={initial.squadNumber}
          />
        )}
      </Field>
      <div className="wl-form-grid__full empty:hidden">
        <FormErrorBanner result={state} />
      </div>
      <div className="wl-form-grid__full">
        <SubmitButton
          block
          pendingLabel={mode === "create" ? "Adding…" : "Saving…"}
          className="justify-center"
        >
          {mode === "create" ? "Add player" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );

  if (mode === "edit") {
    return (
      <>
        <div aria-live="polite" className="mb-4 empty:mb-0">
          <SuccessBanner result={state} />
        </div>
        {form}
      </>
    );
  }
  return (
    <>
      <div aria-live="polite" className="mt-6 empty:mt-0">
        {state?.ok && (
          <Banner tone="ok">
            {state.message}{" "}
            {state.href && (
              <Link href={state.href} className="text-pitch underline">
                View player
              </Link>
            )}
          </Banner>
        )}
      </div>
      <section aria-label="Player details" className="wl-card mt-6 max-w-3xl">
        {form}
      </section>
    </>
  );
}
