"use client";

import Link from "next/link";
import { useRef } from "react";
import {
  Field,
  fieldError,
  FormBusy,
  FormErrorBanner,
  SubmitButton,
  useFocusFirstInvalid,
  useFormAction,
} from "@/components/forms";
import { ButtonLink } from "@/components/ui/Button";
import type { ActionResult } from "@/lib/action-result";
import { updateMatchAction } from "./[matchId]/actions";
import { createMatchAction } from "./actions";

export type TeamOption = { id: string; label: string };

export type MatchValues = {
  homeTeamId: string;
  awayTeamId: string;
  playedAt: string;
  venue: string;
  competition: string;
  halfLengthMinutes: string;
};

function TeamSelect({
  name,
  label,
  defaultValue,
  own,
  opposition,
  error,
}: {
  name: string;
  label: string;
  defaultValue: string;
  own: TeamOption[];
  opposition: TeamOption[];
  error?: string;
}) {
  return (
    <Field label={label} error={error}>
      {(p) => (
        <select {...p} name={name} className="wl-input" defaultValue={defaultValue}>
          <option value="">Choose a team</option>
          <optgroup label="Your teams">
            {own.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </optgroup>
          {opposition.length > 0 && (
            <optgroup label="Opposition">
              {opposition.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      )}
    </Field>
  );
}

/**
 * The match form (MATCH01; docs/build/design/C06.md, Surface 2): home v away,
 * date, venue, competition and half length. Create redirects to the new match;
 * edit saves and returns to it.
 */
export function MatchForm(
  props: {
    own: TeamOption[];
    opposition: TeamOption[];
    initial: MatchValues;
  } & ({ mode: "create" } | { mode: "edit"; matchId: string }),
) {
  const action = props.mode === "create" ? createMatchAction : updateMatchAction;
  const { state, formProps } = useFormAction(action, null as ActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(formRef, state);
  const v = props.initial;

  return (
    <form
      ref={formRef}
      {...formProps}
      noValidate
      className="mt-6 flex max-w-2xl flex-col gap-4 border border-line bg-panel p-5 touch:p-4"
    >
      <FormBusy formRef={formRef} />
      {props.mode === "edit" && <input type="hidden" name="matchId" value={props.matchId} />}
      <div>
        <div className="grid gap-3 tablet:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] tablet:items-end">
          <TeamSelect
            name="homeTeamId"
            label="Home team"
            defaultValue={v.homeTeamId}
            own={props.own}
            opposition={props.opposition}
            error={fieldError(state, "homeTeamId")}
          />
          <span
            className="hidden font-mono text-ink-muted tablet:block tablet:pb-2.5"
            aria-hidden="true"
          >
            v
          </span>
          <TeamSelect
            name="awayTeamId"
            label="Away team"
            defaultValue={v.awayTeamId}
            own={props.own}
            opposition={props.opposition}
            error={fieldError(state, "awayTeamId")}
          />
        </div>
        {props.mode === "create" && (
          <p className="mt-2 text-body-s text-ink-muted">
            Opposition not listed?{" "}
            <Link
              href="/squad/teams/new?kind=opposition&next=/matches/new"
              className="text-brand-text underline underline-offset-3"
            >
              Add an opposition team
            </Link>
          </p>
        )}
      </div>
      <Field label="Date" error={fieldError(state, "playedAt")}>
        {(p) => (
          <input
            {...p}
            type="date"
            name="playedAt"
            className="wl-input"
            required
            defaultValue={v.playedAt}
          />
        )}
      </Field>
      <Field
        label="Venue"
        hint="Optional. For example Dobsonville Stadium."
        error={fieldError(state, "venue")}
      >
        {(p) => (
          <input {...p} name="venue" className="wl-input" maxLength={120} defaultValue={v.venue} />
        )}
      </Field>
      <Field
        label="Competition"
        hint="Optional. For example Gauteng Development League."
        error={fieldError(state, "competition")}
      >
        {(p) => (
          <input
            {...p}
            name="competition"
            className="wl-input"
            maxLength={120}
            defaultValue={v.competition}
          />
        )}
      </Field>
      <Field
        label="Half length (min)"
        hint="Minutes in each half. Many U9 to U13 matches play 20 to 35."
        error={fieldError(state, "halfLengthMinutes")}
      >
        {(p) => (
          <input
            {...p}
            type="number"
            inputMode="numeric"
            name="halfLengthMinutes"
            min={10}
            max={60}
            className="wl-input w-full font-mono tabular-nums tablet:w-auto"
            defaultValue={v.halfLengthMinutes}
          />
        )}
      </Field>
      <FormErrorBanner result={state} />
      <div className="wl-row">
        {props.mode === "create" ? (
          <SubmitButton block pendingLabel="Creating…" className="justify-center">
            Create match
          </SubmitButton>
        ) : (
          <>
            <SubmitButton block pendingLabel="Saving…" className="justify-center">
              Save changes
            </SubmitButton>
            <ButtonLink
              variant="ghost"
              href={`/matches/${props.matchId}`}
              block
              className="justify-center"
            >
              Cancel
            </ButtonLink>
          </>
        )}
      </div>
    </form>
  );
}
