"use client";

import { Upload, X } from "lucide-react";
import { startTransition, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Field,
  FormErrorBanner,
  SubmitButton,
  SuccessBanner,
  useFocusFirstInvalid,
  useFormAction,
} from "@/components/forms";
import type { SectionForm } from "@/components/section-result";
import { iconProps } from "@/components/ui/icons";
import type { ActionResult } from "@/lib/action-result";
import { importTagsAction } from "./actions";

const SOURCE_WORDS: Record<string, string> = {
  hand: "hand",
  synthetic: "synthetic",
  soccernet: "SoccerNet",
};

const EXAMPLE = `type,time,teamSide,onTarget
goal,12:04.2,home,
shot,12:03.8,home,true
shot,31:40.0,away,false
touch,31:38.6,,`;

/**
 * The tag import form (docs/build/design/C09.md, Surface 3, "Import tags"). A
 * file or pasted CSV; when the source already has tags, a confirmation first.
 * Row errors arrive as fieldErrors "row.{i}" (at most 20) plus "rowsMore".
 */
export function ImportTagsForm({
  matchId,
  counts,
}: {
  matchId: string;
  counts: Record<string, number>;
}) {
  const { state, pending, formProps } = useFormAction(importTagsAction, null as ActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  const [source, setSource] = useState("hand");
  useFocusFirstInvalid(formRef, state);
  // A new key after each success resets the form.
  const formKey = state?.ok ? (state.key ?? "done") : "form";
  const existing = counts[source] ?? 0;
  const word = SOURCE_WORDS[source] ?? source;

  // The replace confirmation posts the import form's own fields (the file
  // cannot travel as a hidden field). It closes on any result: the row errors
  // show in the card.
  const confirmForm: SectionForm = {
    state,
    pending,
    formProps: {
      action: formProps.action,
      onSubmit: (e) => {
        e.preventDefault();
        const form = formRef.current;
        if (!form) return;
        const data = new FormData(form);
        startTransition(() => formProps.action(data));
      },
    },
  };

  const rows =
    state && !state.ok
      ? Object.entries(state.fieldErrors ?? {})
          .filter(([k]) => k.startsWith("row."))
          .map(([, v]) => v)
      : [];
  const more = state && !state.ok ? Number(state.fieldErrors?.rowsMore ?? 0) : 0;
  const fileError = state && !state.ok ? state.fieldErrors?.file : undefined;
  const nowText = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${SOURCE_WORDS[s] ?? s} tags`)
    .join(" · ");

  return (
    <div className="wl-card max-w-2xl">
      <div aria-live="polite">
        <SuccessBanner result={state} />
      </div>
      <p className="body text-ink-muted">
        Hand-tagged events are the ground truth for recall. Importing replaces this match&apos;s
        tags from the same source.
      </p>
      <p className="caption mt-2 text-ink-muted">{nowText ? `Now: ${nowText}` : "No tags yet."}</p>
      <form
        key={formKey}
        ref={formRef}
        {...formProps}
        noValidate
        aria-busy={pending || undefined}
        encType="multipart/form-data"
        className="mt-4 flex flex-col gap-4"
      >
        <input type="hidden" name="matchId" value={matchId} />
        <Field label="Source" hint="Tags from other sources stay as they are.">
          {(p) => (
            <select
              {...p}
              name="source"
              className="wl-input"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="hand">Hand-tagged</option>
              <option value="synthetic">Synthetic truth</option>
              <option value="soccernet">SoccerNet labels</option>
            </select>
          )}
        </Field>
        <Field label="CSV file" hint="Up to 2,000 rows and 1 MB." error={fileError}>
          {(p) => (
            <input
              {...p}
              type="file"
              name="file"
              accept=".csv,text/csv"
              className="wl-input wl-file"
            />
          )}
        </Field>
        <Field label="Or paste CSV" hint="Use one or the other.">
          {(p) => (
            <textarea
              {...p}
              name="csv"
              rows={8}
              spellCheck={false}
              autoComplete="off"
              className="wl-input data h-auto"
            />
          )}
        </Field>
        <details className="mt-2">
          <summary className="label">CSV format</summary>
          <p className="body mt-2">
            Columns: type, time, teamSide, onTarget. The first row is the header. type is goal, shot
            or touch. time is the video time as 47:12.4 or in ms. teamSide is home, away or blank.
            onTarget is true, false or blank, for shots only. A goal is also a shot: tag both.
          </p>
          <pre className="data wl-card mt-2 overflow-x-auto bg-surface-sunken">{EXAMPLE}</pre>
        </details>
        <FormErrorBanner result={state} />
        {rows.length > 0 && (
          <>
            <ul className="wl-issues mt-3">
              {rows.map((r) => (
                <li key={r} className="wl-issues__reject">
                  <X {...iconProps} />
                  <p className="body">{r}</p>
                </li>
              ))}
            </ul>
            {more > 0 && (
              <p className="caption text-ink-muted">and {more} more rows with errors.</p>
            )}
          </>
        )}
        {existing === 0 && (
          <div>
            <SubmitButton
              icon={Upload}
              pendingLabel="Importing…"
              pending={pending}
              className="max-md:w-full"
            >
              Import tags
            </SubmitButton>
          </div>
        )}
      </form>
      {existing > 0 && (
        <div className="mt-4">
          <ConfirmDialog
            trigger={{ label: "Import tags", variant: "primary", icon: Upload, block: true }}
            title={`Replace ${existing} ${word} tags?`}
            body={
              <p className="body">
                Importing replaces this match&apos;s {word} tags. Recall is worked out again from
                the new ones.
              </p>
            }
            form={confirmForm}
            hidden={{}}
            submit={{ label: "Replace tags", pendingLabel: "Importing…", variant: "primary" }}
            closeOnError
          />
        </div>
      )}
    </div>
  );
}
