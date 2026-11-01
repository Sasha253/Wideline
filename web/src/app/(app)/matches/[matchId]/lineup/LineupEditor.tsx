"use client";

import { ChevronRight, CircleAlert } from "lucide-react";
import { useId, useRef, useState } from "react";
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
import { ConsentBadge } from "@/components/ui/ConsentBadge";
import { cx } from "@/components/ui/cx";
import { iconProps } from "@/components/ui/icons";
import type { ConsentState } from "@/generated/prisma/enums";
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
  /** The club's own players only: whether scouts can see them (never shown for the opposition). */
  consent?: ConsentState;
};

const SELECTION_LABELS: Record<Selection, string> = {
  none: "Not selected",
  starter: "Starter",
  substitute: "Substitute",
};

/**
 * The columns of the sheet from 768px (Screens A, "Upload · lineup"): No. (64px, the
 * number right-aligned in mono), player with their selection, position, consent.
 */
const GRID =
  "tablet:grid tablet:grid-cols-[64px_minmax(0,1fr)_96px_24px] tablet:items-center tablet:gap-x-2.5";

/** Shirt numbers used by more than one selected player. */
function duplicateNumbers(
  rows: EditorRow[],
  selections: Record<string, Selection>,
  shirts: Record<string, string>,
): Set<string> {
  const seen = new Map<string, number>();
  for (const r of rows) {
    if ((selections[r.playerId] ?? "none") === "none") continue;
    const n = (shirts[r.playerId] ?? "").trim();
    if (n) seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, c]) => c > 1).map(([n]) => n));
}

/**
 * One side's lineup sheet (SQUAD05; docs/build/design/C06.md, Surface 4; Floodlight
 * Screens A, "Upload · lineup"): starters first, then the substitutes and the rest of the
 * squad under a "Substitutes" disclosure. Each row is a fieldset with shirt number,
 * selection and position, and the player's consent for the club's own side. A shirt
 * number used twice is flagged as soon as it is typed; the server checks again on save.
 * Rows stay in the group they loaded in, so focus stays put while selecting. Locked: the
 * same layout as text.
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
  const ids = useId();
  const dupId = `${ids}-duplicates`;
  const groupId = `${ids}-bench`;
  const { state, formProps } = useFormAction(saveLineupAction, null as ActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(formRef, state);
  const [selections, setSelections] = useState<Record<string, Selection>>(() =>
    Object.fromEntries(rows.map((r) => [r.playerId, r.selection])),
  );
  const [shirts, setShirts] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.playerId, r.shirtNumber?.toString() ?? ""])),
  );
  const startersFirst = rows.filter((r) => r.selection === "starter");
  const bench = rows.filter((r) => r.selection !== "starter");
  // A new lineup has no starters yet: the whole squad shows.
  const [benchOpen, setBenchOpen] = useState(startersFirst.length === 0);
  const values = Object.values(selections);
  const starters = values.filter((s) => s === "starter").length;
  const substitutes = values.filter((s) => s === "substitute").length;
  const duplicates = duplicateNumbers(rows, selections, shirts);
  const showConsent = rows.some((r) => r.consent !== undefined);

  const counter = (
    <p className="font-mono text-body-s text-ink-muted tabular-nums" aria-live="polite">
      <span className="text-ink">{starters}</span> starting ·{" "}
      <span className="text-ink">{substitutes}</span> {substitutes === 1 ? "sub" : "subs"}
    </p>
  );

  const head = (
    <div
      className={cx(
        "hidden h-7.5 border-b border-line px-3.5 font-mono text-overline text-ink-muted uppercase",
        GRID,
      )}
      aria-hidden="true"
    >
      <span>No.</span>
      <span>Player</span>
      <span>Position</span>
      <span />
    </div>
  );

  const consentCell = (r: EditorRow) =>
    showConsent ? (
      <span className="flex items-center tablet:justify-center">
        {r.consent !== undefined && <ConsentBadge state={r.consent} iconOnly />}
      </span>
    ) : (
      <span />
    );

  if (locked) {
    const selected = rows
      .filter((r) => r.selection !== "none")
      .sort((a, b) => (a.selection === b.selection ? 0 : a.selection === "starter" ? -1 : 1));
    return (
      <div className="mt-4 max-w-4xl">
        <div className="border border-line bg-panel">
          <div className="border-b border-line px-3.5 py-3">{counter}</div>
          {head}
          <ul role="list">
            {selected.map((r) => (
              <li
                key={r.playerId}
                className={cx(
                  "flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-3.5 py-3 last:border-b-0 tablet:min-h-11.5 tablet:py-1.5",
                  GRID,
                )}
              >
                {/* Below 768px there is no head row, so each value carries its label. */}
                <span className="font-mono tabular-nums tablet:text-right">
                  <span className="mr-2 font-ui text-body-s text-ink-muted tablet:sr-only">
                    Shirt
                  </span>
                  {r.shirtNumber !== null ? r.shirtNumber : <Missing />}
                </span>
                <span className="flex min-w-0 basis-full items-baseline gap-2 tablet:basis-auto">
                  <span className="truncate font-medium">{r.name}</span>
                  <span className="shrink-0 text-body-s text-ink-muted">
                    {SELECTION_LABELS[r.selection]}
                  </span>
                </span>
                <span>
                  <span className="mr-2 text-body-s text-ink-muted tablet:sr-only">Position</span>
                  {positionLabel(r.position) ?? <Missing />}
                </span>
                {consentCell(r)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const duplicateList = [...duplicates].sort((a, b) => Number(a) - Number(b));
  // A save error or a duplicate number on the bench keeps the bench open, so the field it
  // names can take focus.
  const benchHasDuplicate = bench.some(
    (r) =>
      (selections[r.playerId] ?? "none") !== "none" &&
      duplicates.has((shirts[r.playerId] ?? "").trim()),
  );
  const showBench = benchOpen || (!!state && !state.ok) || benchHasDuplicate;

  const row = (r: EditorRow) => {
    const selection = selections[r.playerId] ?? "none";
    const off = selection === "none";
    const name = `rows[${r.playerId}]`;
    const dup = !off && duplicates.has((shirts[r.playerId] ?? "").trim());
    return (
      <li key={r.playerId} className="border-b border-line last:border-b-0">
        <fieldset
          className={cx(
            "m-0 grid grid-cols-2 gap-x-3 gap-y-2 border-0 px-3.5 py-3 tablet:min-h-11.5 tablet:py-1.5",
            GRID,
            "tablet:[&_.wl-field__label]:sr-only tablet:[&_.wl-field]:gap-0",
            off && "text-ink-muted",
          )}
          data-selected={off ? "false" : "true"}
        >
          <legend className="sr-only">{r.name}</legend>
          <Field label="Shirt number" error={fieldError(state, `${r.playerId}.shirtNumber`)}>
            {(p) => (
              <input
                {...p}
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                name={`${name}.shirtNumber`}
                className="wl-input text-right font-mono tabular-nums"
                value={shirts[r.playerId] ?? ""}
                onChange={(e) => setShirts((s) => ({ ...s, [r.playerId]: e.target.value }))}
                aria-invalid={dup || p["aria-invalid"] ? true : undefined}
                aria-describedby={
                  [p["aria-describedby"], dup ? dupId : null].filter(Boolean).join(" ") || undefined
                }
                readOnly={r.isPlaceholder}
                disabled={off}
              />
            )}
          </Field>
          <span className="col-span-2 flex min-w-0 flex-col gap-2 tablet:col-span-1 tablet:flex-row tablet:items-center tablet:gap-2.5">
            <span className="flex min-w-0 flex-1 items-baseline gap-2" aria-hidden="true">
              <span className={cx("truncate font-medium", !off && "text-ink")}>{r.name}</span>
              {r.squadNumber !== null && !r.isPlaceholder && (
                <span className="shrink-0 font-mono text-body-s text-ink-muted tabular-nums">
                  Squad no. {r.squadNumber}
                </span>
              )}
            </span>
            <Field label="Selection" className="tablet:w-36 tablet:shrink-0">
              {(p) => (
                <select
                  {...p}
                  name={`${name}.selection`}
                  className="wl-input"
                  value={selection}
                  onChange={(e) =>
                    setSelections((s) => ({
                      ...s,
                      [r.playerId]: e.target.value as Selection,
                    }))
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
          </span>
          <Field label="Position">
            {(p) => (
              <select
                {...p}
                name={`${name}.position`}
                className="wl-input font-mono"
                defaultValue={r.position ?? ""}
                disabled={off}
              >
                <option value="">None</option>
                {POSITIONS.map((pos) => (
                  // The 96px column shows the code, as on the squad sheet ("CB").
                  <option key={pos.code} value={pos.code} title={pos.label}>
                    {pos.code}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {consentCell(r)}
        </fieldset>
      </li>
    );
  };

  return (
    <form ref={formRef} {...formProps} noValidate className="mt-4 max-w-4xl">
      <FormBusy formRef={formRef} />
      <input type="hidden" name="matchId" value={matchId} />
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="playerIds" value={rows.map((r) => r.playerId).join(",")} />
      <div aria-live="polite" className="mb-4 empty:mb-0">
        <SuccessBanner key={state?.ok ? state.key : undefined} result={state} />
      </div>
      <div className="border border-line bg-panel">
        <div className="border-b border-line px-3.5 py-3">{counter}</div>
        {head}
        {startersFirst.length > 0 && <ul role="list">{startersFirst.map(row)}</ul>}
        {duplicateList.length > 0 && (
          <p
            id={dupId}
            role="alert"
            className="flex items-center gap-2 border-y border-line px-3.5 py-2.5 font-medium text-rejected"
          >
            <CircleAlert {...iconProps} size={16} className="shrink-0" />
            {duplicateList.length === 1
              ? `Shirt ${duplicateList[0]} is used twice. Each player needs a different number.`
              : `Shirts ${duplicateList.join(", ")} are used twice. Each player needs a different number.`}
          </p>
        )}
        {bench.length > 0 && (
          <>
            <button
              type="button"
              aria-expanded={showBench}
              aria-controls={groupId}
              className="flex h-control-l w-full items-center gap-2 border-t border-line px-3.5 text-left text-label -outline-offset-2 hover:bg-raised"
              onClick={() => setBenchOpen(!showBench)}
            >
              <ChevronRight
                {...iconProps}
                size={16}
                aria-hidden
                className={cx("text-ink-muted", showBench && "rotate-90")}
              />
              Substitutes
              <span className="font-mono text-body-s text-ink-muted tabular-nums">
                {substitutes}
              </span>
            </button>
            {/* Hidden rows still submit: hidden fields are sent, only disabled ones are not. */}
            <ul id={groupId} role="list" hidden={!showBench} className="border-t border-line">
              {bench.map(row)}
            </ul>
          </>
        )}
      </div>
      <div className="mt-4 flex flex-col gap-4">
        <FormErrorBanner result={state} />
        <div>
          <SubmitButton block pendingLabel="Saving" className="justify-center">
            Save lineup
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
