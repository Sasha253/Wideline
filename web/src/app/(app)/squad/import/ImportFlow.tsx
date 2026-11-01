"use client";

import { CircleAlert, CircleCheck, Download, Info } from "lucide-react";
import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import {
  Banner,
  Field,
  fieldError,
  FormBusy,
  FormErrorBanner,
  SubmitButton,
  useFocusFirstInvalid,
} from "@/components/forms";
import { DataTable, Missing } from "@/components/templates/DataTable";
import { Button, ButtonLink } from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icons";
import type { ActionResult } from "@/lib/action-result";
import { teamLabel } from "@/lib/labels";
import { CSV_MAX_BYTES, POSITIONS } from "@/lib/squad-fields";
import type { ImportRow } from "@/server/squad/import";
import { commitImportAction, previewImportAction } from "./actions";
import type { ImportState } from "./state";

type Team = { id: string; label: string };

const TOO_LARGE =
  "This file is larger than 512 KB. Split it into smaller files and import each one.";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// True after hydration, false on the server and during hydration (RegisterForm pattern).
const noop = () => () => {};
const useEnhanced = () =>
  useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

const STEP_TITLES = { upload: "Choose a file", preview: "Check the preview", done: "Done" };
const STEP_NUMBER = { upload: 1, preview: 2, done: 3 };

/**
 * The three import steps (docs/build/design/C04.md, Surface 6). Each server
 * action returns the next step's data. The preview carries the CSV text and
 * its digest back to the commit, so nothing is stored in between; a refresh
 * starts again at step 1. Each step change moves focus to the step heading.
 */
export function ImportFlow({ teams, defaultTeamId }: { teams: Team[]; defaultTeamId: string }) {
  const [previewState, previewDispatch] = useActionState(previewImportAction, null as ImportState);
  const [commitState, commitDispatch] = useActionState(commitImportAction, null as ImportState);
  const [last, setLast] = useState<"preview" | "commit" | null>(null);
  // The results the person left with "Choose another file" or "Import another file":
  // both actions' states, so an older preview never shows again while a new check runs.
  const [dismissed, setDismissed] = useState<ImportState[]>([]);
  const [focusFile, setFocusFile] = useState(false);
  // Remounts step 1 after "Choose another file", so the kept team is selected.
  const [round, setRound] = useState(0);
  const [keptFrom, setKeptFrom] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const ids = useId();

  // Without JavaScript only the action that answered has a state.
  const latest = last === "commit" || (!last && commitState) ? commitState : previewState;
  const state: ImportState = latest && !dismissed.includes(latest) ? latest : null;
  const step = state?.step ?? "upload";

  const keptTeam = keptFrom ?? defaultTeamId;

  // Focus the step heading whenever the step changes or a stale preview arrives, never on load.
  const focusKey = state ? `${step}-${state.step === "preview" && state.stale}` : "start";
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (focusKey !== "start" && !(state?.step === "upload")) headingRef.current?.focus();
  }, [focusKey, state]);

  function submitTo(which: "preview" | "commit") {
    return (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      setLast(which);
      startTransition(() => (which === "preview" ? previewDispatch : commitDispatch)(formData));
    };
  }

  function startAgain() {
    setDismissed([previewState, commitState].filter((x) => x !== null));
    setKeptFrom(
      latest?.step === "preview"
        ? latest.preview.team.id
        : latest?.step === "done"
          ? latest.team.id
          : null,
    );
    setRound((r) => r + 1);
    setFocusFile(true);
  }

  const n = STEP_NUMBER[step];
  return (
    <section aria-labelledby={`${ids}-eyebrow ${ids}-title`} className="mt-8">
      <p id={`${ids}-eyebrow`} className="font-mono text-overline uppercase text-ink-muted">
        Step {n} of 3
      </p>
      <h2
        id={`${ids}-title`}
        ref={headingRef}
        tabIndex={-1}
        className="font-display text-heading-section uppercase stretch-wide"
      >
        {STEP_TITLES[step]}
      </h2>
      <div className="wl-steps mt-3" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className="wl-steps__seg"
            data-done={i < n ? "true" : undefined}
            data-current={i === n ? "true" : undefined}
          />
        ))}
      </div>

      {state?.step === "preview" ? (
        <PreviewStep
          state={state}
          onSubmit={submitTo("commit")}
          action={commitDispatch}
          onChooseAnother={startAgain}
        />
      ) : state?.step === "done" ? (
        <DoneStep state={state} onImportAnother={startAgain} />
      ) : (
        <UploadStep
          key={round}
          teams={teams}
          teamId={keptTeam}
          result={state?.step === "upload" ? state.result : null}
          onSubmit={submitTo("preview")}
          action={previewDispatch}
          focusFile={focusFile}
          onFocused={() => setFocusFile(false)}
        />
      )}
    </section>
  );
}

function UploadStep({
  teams,
  teamId,
  result,
  onSubmit,
  action,
  focusFile,
  onFocused,
}: {
  teams: Team[];
  teamId: string;
  result: ActionResult;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  action: (formData: FormData) => void;
  focusFile: boolean;
  onFocused: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // A file over the cap never leaves the browser: Next refuses bodies over 1 MB before the action runs.
  const [local, setLocal] = useState<ActionResult>(null);
  const shown = local ?? result;
  useFocusFirstInvalid(formRef, shown);
  useEffect(() => {
    if (!focusFile) return;
    fileRef.current?.focus();
    onFocused();
  }, [focusFile, onFocused]);

  function check(e: FormEvent<HTMLFormElement>) {
    const file = fileRef.current?.files?.[0];
    if (file && file.size > CSV_MAX_BYTES) {
      e.preventDefault();
      setLocal({ ok: false, fieldErrors: { file: TOO_LARGE } });
      return;
    }
    setLocal(null);
    onSubmit(e);
  }

  return (
    <div className="mt-6 grid grid-cols-1 gap-6 desktop:grid-cols-12">
      <form
        ref={formRef}
        action={action}
        onSubmit={check}
        encType="multipart/form-data"
        noValidate
        className="wl-card flex flex-col gap-4 desktop:col-span-6"
      >
        <FormBusy formRef={formRef} />
        <Field
          label="Team"
          hint="Players are added to this team."
          error={fieldError(shown, "teamId")}
        >
          {(p) => (
            <select {...p} name="teamId" className="wl-input" defaultValue={teamId}>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label="CSV file"
          hint="Up to 500 players and 512 KB. In Excel or Google Sheets, save or download the sheet as CSV."
          error={fieldError(shown, "file")}
        >
          {(p) => (
            <input
              {...p}
              ref={fileRef}
              type="file"
              name="file"
              accept=".csv,text/csv"
              className="wl-input wl-file"
            />
          )}
        </Field>
        <FormErrorBanner result={shown} />
        <div className="wl-row">
          <SubmitButton block pendingLabel="Checking" className="justify-center">
            Check file
          </SubmitButton>
          <ButtonLink
            variant="ghost"
            icon={Download}
            href="/squad/import/template"
            download
            prefetch={false}
            block
            className="justify-center"
          >
            Download the template
          </ButtonLink>
        </div>
      </form>
      <ColumnHelp />
    </div>
  );
}

const COLUMN_HELP: [string, boolean, string][] = [
  ["First name", true, "Up to 60 characters."],
  ["Last name", true, "Up to 60 characters. Also accepted as Surname."],
  [
    "Date of birth",
    true,
    "14/03/2011, 2011-03-14 or 2011/03/14. Day first, never month first. Also DOB.",
  ],
  [
    "Position",
    false,
    `A code: ${POSITIONS.map((p) => p.code)
      .join(", ")
      .replace(/, ST$/, " or ST")}.`,
  ],
  ["Preferred foot", false, "Left, Right or Both, or L, R or B. Also Foot."],
  ["Height", false, "Centimetres, 100 to 230. Also Height_cm."],
  ["Squad number", false, "1 to 99, once per team. Also Number or Shirt."],
];

function ColumnHelp() {
  const id = useId();
  return (
    <section aria-labelledby={id} className="wl-card desktop:col-span-6">
      <h3 id={id} className="font-semibold">
        Columns
      </h3>
      <p className="mt-1 text-ink-muted">
        The first row of the file names the columns. Upper or lower case both work, and columns we
        do not use are ignored.
      </p>
      <table className="wl-table mt-4 hidden tablet:table">
        <caption className="sr-only">CSV columns</caption>
        <thead>
          <tr>
            <th scope="col" className="text-label">
              Column
            </th>
            <th scope="col" className="text-label">
              Needed
            </th>
            <th scope="col" className="text-label">
              What to put in it
            </th>
          </tr>
        </thead>
        <tbody>
          {COLUMN_HELP.map(([name, needed, text]) => (
            <tr key={name}>
              <td className="font-semibold">{name}</td>
              <td>{needed ? "Yes" : "No"}</td>
              <td>{text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-4 flex flex-col gap-3 tablet:hidden">
        {COLUMN_HELP.map(([name, needed, text]) => (
          <div key={name}>
            <dt className="font-semibold">{name}</dt>
            <dd>
              {needed ? "Needed" : "Optional"}. {text}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-body-s mt-2 text-ink-muted">
        Commas, semicolons and tabs all work as separators.
      </p>
    </section>
  );
}

function RowErrors({ row }: { row: ImportRow }) {
  return (
    <ul className="flex flex-col gap-1">
      {row.errors.map((e, i) => (
        <li key={i} className="wl-inline-status wl-inline-status--danger text-body-s">
          <CircleAlert {...iconProps} />
          <span>
            {e.label}: {e.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Ready() {
  return (
    <span className="wl-inline-status wl-inline-status--ok text-body-s">
      <CircleCheck {...iconProps} />
      Ready
    </span>
  );
}

const asIs = (v: string | undefined) => (v ? v : <Missing />);

function PreviewStep({
  state,
  onSubmit,
  action,
  onChooseAnother,
}: {
  state: Extract<ImportState, { step: "preview" }>;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  action: (formData: FormData) => void;
  onChooseAnother: () => void;
}) {
  const { preview, fileName } = state;
  const v = preview.validCount;
  const e = preview.errorCount;
  const [onlyErrors, setOnlyErrors] = useState(false);
  const hydrated = useEnhanced();
  const rowsId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const rows = onlyErrors ? preview.rows.filter((r) => r.errors.length > 0) : preview.rows;

  const summary =
    v === 0
      ? "No rows can be imported. Fix the errors in your file and choose it again."
      : e === 0
        ? `${plural(v, "row", "rows")} ready.`
        : `${plural(v, "row", "rows")} ready, ${plural(e, "row", "rows")} with errors.`;
  const importLabel =
    e === 0
      ? `Import ${plural(v, "player", "players")}`
      : `Import ${plural(v, "player", "players")}, skip ${plural(e, "row", "rows")} with errors`;

  return (
    <>
      <div aria-live="polite" className="mt-4 empty:mt-0">
        {state.stale && (
          <Banner tone="warn">
            The squad changed after you checked this file, so the preview is updated. Nothing was
            imported. Check it again, then confirm.
          </Banner>
        )}
      </div>
      <div className="mt-4">
        <p className="font-semibold">
          {teamLabel(preview.team)}{" "}
          <span className="text-body-s break-all text-ink-muted">· from {fileName}</span>
        </p>
        <p className="text-body mt-1">{summary}</p>
        {e > 0 && v > 0 && (
          <p className="mt-1 text-ink-muted">
            Rows with errors are skipped. Fix them in your file and import it again later to add
            those players.
          </p>
        )}
        {preview.ignoredColumns.length > 0 && (
          <p className="wl-inline-status wl-inline-status--muted text-body-s mt-2">
            <Info {...iconProps} />
            Ignored columns: {preview.ignoredColumns.join(", ")}. They are not imported.
          </p>
        )}
      </div>

      <form ref={formRef} action={action} onSubmit={onSubmit} noValidate className="mt-4">
        <FormBusy formRef={formRef} />
        <input type="hidden" name="teamId" value={preview.team.id} />
        <input type="hidden" name="csvText" value={preview.csvText} />
        <input type="hidden" name="digest" value={preview.digest} />
        <input type="hidden" name="expectedValid" value={String(v)} />
        <input type="hidden" name="fileName" value={fileName} />
        <div className="wl-row">
          {v > 0 && (
            <SubmitButton block pendingLabel="Importing" className="justify-center">
              {importLabel}
            </SubmitButton>
          )}
          {hydrated ? (
            <Button
              variant={v === 0 ? "primary" : "secondary"}
              block
              className="justify-center"
              onClick={onChooseAnother}
            >
              Choose another file
            </Button>
          ) : (
            <ButtonLink
              variant={v === 0 ? "primary" : "secondary"}
              href={`/squad/import?team=${preview.team.id}`}
              block
              className="justify-center"
            >
              Choose another file
            </ButtonLink>
          )}
        </div>
        <div className="mt-4 empty:mt-0">
          <FormErrorBanner result={state.result} />
        </div>
      </form>

      {hydrated && e > 0 && (
        <>
          <label className="wl-choice mt-6">
            <input
              type="checkbox"
              checked={onlyErrors}
              aria-controls={rowsId}
              onChange={(ev) => setOnlyErrors(ev.target.checked)}
            />
            Show only rows with errors ({e})
          </label>
          <p aria-live="polite" className="sr-only">
            {onlyErrors ? `Showing ${plural(rows.length, "row", "rows")}.` : ""}
          </p>
        </>
      )}

      <div id={rowsId} className="mt-4">
        <DataTable
          caption={`Rows in ${fileName}, by line`}
          columns={[
            { id: "line", header: "Line", numeric: true },
            { id: "first", header: "First name" },
            { id: "last", header: "Last name" },
            { id: "dob", header: "Date of birth" },
            { id: "position", header: "Position" },
            { id: "foot", header: "Foot" },
            { id: "height", header: "Height", numeric: true },
            { id: "no", header: "No.", numeric: true },
            { id: "result", header: "Result" },
          ]}
          rows={rows.map((r) => ({
            id: String(r.line),
            cells: [
              r.line,
              <span key="first" className="break-words">
                {asIs(r.values.firstName)}
              </span>,
              <span key="last" className="break-words">
                {asIs(r.values.lastName)}
              </span>,
              <span key="dob" className="font-mono text-mono-m tabular-nums">
                {asIs(r.values.dateOfBirth)}
              </span>,
              asIs(r.values.position),
              asIs(r.values.preferredFoot),
              asIs(r.values.heightCm),
              asIs(r.values.squadNumber),
              r.errors.length === 0 ? <Ready key="result" /> : <RowErrors key="result" row={r} />,
            ],
          }))}
          cards={rows.map((r) => {
            const name = [r.values.firstName, r.values.lastName].filter(Boolean).join(" ");
            const meta = [
              r.values.dateOfBirth,
              r.values.position,
              r.values.preferredFoot,
              r.values.heightCm,
              r.values.squadNumber && `No. ${r.values.squadNumber}`,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={r.line} className="wl-card flex flex-col gap-2">
                <div className="flex justify-between gap-3">
                  <span className="text-label text-ink-muted">Line {r.line}</span>
                  {r.errors.length === 0 ? (
                    <Ready />
                  ) : (
                    <span className="wl-inline-status wl-inline-status--danger text-body-s">
                      <CircleAlert {...iconProps} />
                      {plural(r.errors.length, "error", "errors")}
                    </span>
                  )}
                </div>
                <p className="font-semibold break-words">{name || "No name"}</p>
                {meta && <p className="text-body-s break-words text-ink-muted">{meta}</p>}
                {r.errors.length > 0 && <RowErrors row={r} />}
              </li>
            );
          })}
        />
      </div>
    </>
  );
}

function DoneStep({
  state,
  onImportAnother,
}: {
  state: Extract<ImportState, { step: "done" }>;
  onImportAnother: () => void;
}) {
  return (
    <>
      <div aria-live="polite" className="mt-6">
        <Banner tone="ok">
          {plural(state.created, "player", "players")} added to {state.team.label}.
        </Banner>
      </div>
      {state.skipped > 0 && (
        <p className="mt-4 max-w-prose text-ink-muted">
          {plural(state.skipped, "row was", "rows were")} skipped. Fix them in your file, then
          import it again: players already added are flagged as already in the club, not added
          twice.
        </p>
      )}
      <div className="wl-row mt-6">
        <ButtonLink
          variant="primary"
          href={`/squad?team=${state.team.id}`}
          block
          className="justify-center"
        >
          View squad
        </ButtonLink>
        <Button variant="secondary" block className="justify-center" onClick={onImportAnother}>
          Import another file
        </Button>
      </div>
    </>
  );
}
