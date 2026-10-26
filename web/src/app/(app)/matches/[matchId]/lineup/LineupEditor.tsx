"use client";

import { useRef, useState } from "react";
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
import { Missing } from "@/components/templates/DataTable";
import type { ActionResult } from "@/lib/action-result";
import { POSITIONS, positionLabel } from "@/lib/squad-fields";
import { saveLineupAction } from "./actions";

export type Selection = "none" | "starter" | "substitute";

/** One player row of the sheet. Names are shown on screen only. */
export type EditorRow = {
  playerId: string;
  name: string;
  squadNumber: number | null;
  isPlaceholder: boolean;
  selection: Selection;
  shirtNumber: number | null;
  position: string | null;
};

const SELECTION_LABELS: Record<Selection, string> = {
  none: "Not selected",
  starter: "Starter",
  substitute: "Substitute",
};

/**
 * One side's lineup sheet (SQUAD05; docs/build/design/C06.md, Surface 4): a
 * fieldset per player with selection, shirt number and position. Rows keep
 * the order they loaded in, so focus stays put while selecting. Locked: the
 * same layout as plain text.
 */
export function LineupEditor({
  matchId,
  teamId,
  rows,
  locked,
}: {
  matchId: string;
  teamId: string;
  rows: EditorRow[];
  locked: boolean;
}) {
  const { state, formProps } = useFormAction(saveLineupAction, null as ActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(formRef, state);
  const [selections, setSelections] = useState<Record<string, Selection>>(() =>
    Object.fromEntries(rows.map((r) => [r.playerId, r.selection])),
  );
  const values = Object.values(selections);
  const starters = values.filter((s) => s === "starter").length;
  const substitutes = values.filter((s) => s === "substitute").length;

  const counter = (
    <p className="body mt-4" aria-live="polite">
      <span className="data">{starters}</span> {starters === 1 ? "starter" : "starters"} ·{" "}
      <span className="data">{substitutes}</span> {substitutes === 1 ? "substitute" : "substitutes"}
    </p>
  );

  const head = (
    <div className="wl-lineup__head label" aria-hidden="true">
      <span>Player</span>
      <span>Selection</span>
      <span>Shirt</span>
      <span>Position</span>
    </div>
  );

  if (locked) {
    return (
      <div className="max-w-4xl">
        {counter}
        {head}
        <ul className="wl-lineup" role="list">
          {rows
            .filter((r) => r.selection !== "none")
            .map((r) => (
              <li key={r.playerId}>
                <div className="wl-lineup__row">
                  <p className="wl-lineup__name col-span-2 md:col-span-1">
                    <span className="body-strong">{r.name}</span>
                  </p>
                  <span className="wl-lineup__selection body">{SELECTION_LABELS[r.selection]}</span>
                  {/* Below 768px there is no head row, so each value carries its label. */}
                  <p className="body">
                    <span className="caption mr-2 text-ink-muted md:sr-only">Shirt</span>
                    {r.shirtNumber !== null ? (
                      <span className="data">{r.shirtNumber}</span>
                    ) : (
                      <Missing />
                    )}
                  </p>
                  <p className="body">
                    <span className="caption mr-2 text-ink-muted md:sr-only">Position</span>
                    {positionLabel(r.position) ?? <Missing />}
                  </p>
                </div>
              </li>
            ))}
        </ul>
      </div>
    );
  }

  return (
    <form ref={formRef} {...formProps} noValidate className="max-w-4xl">
      <FormBusy formRef={formRef} />
      <input type="hidden" name="matchId" value={matchId} />
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="playerIds" value={rows.map((r) => r.playerId).join(",")} />
      <div aria-live="polite" className="mt-4 empty:mt-0">
        <SuccessBanner key={state?.ok ? state.key : undefined} result={state} />
      </div>
      {counter}
      <div className="mt-4">{head}</div>
      <ul className="wl-lineup" role="list">
        {rows.map((r) => {
          const selection = selections[r.playerId] ?? "none";
          const off = selection === "none";
          const name = `rows[${r.playerId}]`;
          return (
            <li key={r.playerId}>
              <fieldset className="wl-lineup__row" data-selected={off ? "false" : "true"}>
                <legend className="wl-lineup__name">
                  <span className="body-strong">{r.name}</span>
                  {r.squadNumber !== null && !r.isPlaceholder && (
                    <span className="caption ml-2 text-ink-muted">Squad no. {r.squadNumber}</span>
                  )}
                </legend>
                <Field label="Selection" className="wl-lineup__selection">
                  {(p) => (
                    <select
                      {...p}
                      name={`${name}.selection`}
                      className="wl-input"
                      value={selection}
                      onChange={(e) =>
                        setSelections((s) => ({ ...s, [r.playerId]: e.target.value as Selection }))
                      }
                    >
                      {(Object.keys(SELECTION_LABELS) as Selection[]).map((s) => (
                        <option key={s} value={s}>
                          {SELECTION_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Shirt number" error={fieldError(state, `${r.playerId}.shirtNumber`)}>
                  {(p) => (
                    <input
                      {...p}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={99}
                      name={`${name}.shirtNumber`}
                      className="wl-input"
                      defaultValue={r.shirtNumber ?? ""}
                      readOnly={r.isPlaceholder}
                      disabled={off}
                    />
                  )}
                </Field>
                <Field label="Position">
                  {(p) => (
                    <select
                      {...p}
                      name={`${name}.position`}
                      className="wl-input"
                      defaultValue={r.position ?? ""}
                      disabled={off}
                    >
                      <option value="">No position</option>
                      {POSITIONS.map((pos) => (
                        <option key={pos.code} value={pos.code}>
                          {pos.label}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </fieldset>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-col gap-4">
        <FormErrorBanner result={state} />
        <div>
          <SubmitButton block pendingLabel="Saving…" className="justify-center">
            Save lineup
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
