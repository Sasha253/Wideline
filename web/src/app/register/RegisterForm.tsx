"use client";

import { ArrowLeft, Check, LockKeyhole, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Banner,
  Field,
  FieldErrorText,
  FormBusy,
  FormErrorBanner,
  SubmitButton,
  useFormAction,
} from "@/components/forms";
import { Button } from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icons";
import type { ActionResult } from "@/lib/action-result";
import { EMAIL_ERROR, NAME_TOO_LONG } from "@/lib/form-copy";
import {
  DOCUMENT_REQUIRED,
  ID_OR_PASSPORT_REQUIRED,
  MAX_AFFILIATIONS_PER_TYPE,
  NO_AFFILIATIONS_CHOICE,
  normaliseIdNumber,
  normalisePhone,
  PASSPORT_COUNTRY_REQUIRED,
  PASSPORT_INVALID,
  PASSPORT_REQUIRED,
  PHONE_INVALID,
  PHONE_REQUIRED,
  PLAYER_NAME_REQUIRED,
  SA_ID_INVALID,
  SA_ID_REQUIRED,
  SCOUT_NAME_REQUIRED,
  TERMS_REQUIRED,
} from "@/lib/scout-fields";
import { registerScoutAction } from "./actions";

// Scout registration (docs/build/design/C02.md, Surface 1): one form, one
// fieldset per step, posted once. With JavaScript one step shows at a time;
// without it every step shows stacked and the server checks everything. There
// is no password step: signed out, the account opens through the emailed
// confirmation link, and the scout sets a password on /scout after that.

const STEP_TITLES = [
  "About you",
  "Your identity",
  "Clubs and players you are linked to",
  "Confidentiality terms",
];

const FIX_FIELDS = "Some details need fixing. Check the highlighted fields.";
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The step (0-based) that holds a field error key such as "playerName.2". */
function stepOfKey(key: string): number {
  const head = key.split(".")[0]!;
  if (["name", "email", "phone"].includes(head)) return 0;
  if (["idDocumentType", "idNumber", "idCountry"].includes(head)) return 1;
  if (["clubName", "playerName", "playerClub", "noAffiliations", "affiliations"].includes(head)) {
    return 2;
  }
  return 3;
}

const omitStep = (errors: Record<string, string>, step: number) =>
  Object.fromEntries(Object.entries(errors).filter(([k]) => stepOfKey(k) !== step));

const omitPrefix = (errors: Record<string, string>, prefixes: string[]) =>
  Object.fromEntries(
    Object.entries(errors).filter(([k]) => !prefixes.some((p) => k.startsWith(`${p}.`))),
  );

// True after hydration, false on the server and during hydration.
const noop = () => () => {};
const useEnhanced = () =>
  useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

type DocType = "" | "sa_id" | "passport";
type Focus = { step: number; invalid: boolean } | { selector: string };

export function RegisterForm({
  signedIn,
  countries,
  terms,
}: {
  signedIn: { name: string; email: string } | null;
  countries: { code: string; name: string }[];
  terms: ReactNode;
}) {
  const { state, formProps } = useFormAction(registerScoutAction, null as ActionResult);
  const enhanced = useEnhanced();
  const total = STEP_TITLES.length;
  const last = total - 1;

  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summaryStep, setSummaryStep] = useState<number | null>(null);
  const [docType, setDocType] = useState<DocType>("");
  const [none, setNone] = useState(false);
  // Row keys. Null until the first add or remove: the server renders 3 empty rows
  // per group for the no-JavaScript form, and with JavaScript one shows.
  const [clubRows, setClubRows] = useState<number[] | null>(null);
  const [playerRows, setPlayerRows] = useState<number[] | null>(null);
  const nextKey = useRef(3);

  const formRef = useRef<HTMLFormElement>(null);
  const numberRef = useRef<HTMLInputElement>(null);
  const receivedRef = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<Focus | null>(null);

  const clubs = clubRows ?? (enhanced ? [0] : [0, 1, 2]);
  const players = playerRows ?? (enhanced ? [0] : [0, 1, 2]);

  // Focus moves after the render that shows its target. Declared before the result
  // effect, so it runs on the render after that effect's state changes, not before.
  useEffect(() => {
    const target = pendingFocus.current;
    const form = formRef.current;
    if (!target || !form) return;
    pendingFocus.current = null;
    if ("selector" in target) {
      form.querySelector<HTMLElement>(target.selector)?.focus();
    } else if (target.invalid) {
      form
        .querySelector<HTMLElement>(
          `#step-${target.step + 1} :is([aria-invalid="true"], [data-invalid="true"] input)`,
        )
        ?.focus();
    } else {
      form.querySelector<HTMLElement>(`#step-${target.step + 1}-title`)?.focus();
    }
  });

  // A server result: show the first step with an error and focus its first invalid field.
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      receivedRef.current?.focus();
      return;
    }
    const fieldErrors = state.fieldErrors ?? {};
    const keys = Object.keys(fieldErrors);
    /* eslint-disable react-hooks/set-state-in-effect -- syncing the form to the action result */
    setErrors(fieldErrors);
    if (!keys.length) {
      setSummaryStep(null);
      return;
    }
    const first = Math.min(...keys.map(stepOfKey));
    setStep(first);
    setSummaryStep(first);
    /* eslint-enable react-hooks/set-state-in-effect */
    pendingFocus.current = { step: first, invalid: true };
  }, [state]);

  if (state?.ok) {
    return (
      <>
        <h1 ref={receivedRef} tabIndex={-1} className="heading-1 mt-6">
          {signedIn ? "Registration received" : "Check your email"}
        </h1>
        <p className="body-lg mt-2 text-ink-muted">
          {signedIn ? "We will email you about your registration." : state.message}
        </p>
        {!signedIn && (
          <p className="body mt-4 text-ink-muted">
            No email after a few minutes? Check your spam folder, or{" "}
            <Link href="/login?next=/scout" className="text-pitch underline">
              sign in
            </Link>{" "}
            with Email me a sign-in link.
          </p>
        )}
      </>
    );
  }

  // Without JavaScript the errors come straight from the action result.
  const serverErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const shown = enhanced ? errors : serverErrors;
  const serverFirst = Object.keys(serverErrors).length
    ? Math.min(...Object.keys(serverErrors).map(stepOfKey))
    : null;
  const summaryAt = enhanced ? summaryStep : serverFirst;

  /** The client checks of one step (docs/build/design/C02.md, "Step change"). */
  function check(index: number): Record<string, string> {
    const fd = new FormData(formRef.current!);
    const v = (n: string) => String(fd.get(n) ?? "").trim();
    const e: Record<string, string> = {};
    if (index === 0) {
      if (!signedIn) {
        const name = v("name");
        if (!name) e.name = SCOUT_NAME_REQUIRED;
        else if (name.length > 120) e.name = NAME_TOO_LONG;
        if (!EMAIL_SHAPE.test(v("email"))) e.email = EMAIL_ERROR;
      }
      if (!v("phone")) e.phone = PHONE_REQUIRED;
      else if (!normalisePhone(v("phone"))) e.phone = PHONE_INVALID;
    } else if (index === 1) {
      const doc = v("idDocumentType");
      const number = normaliseIdNumber(v("idNumber"));
      if (!doc) {
        e.idDocumentType = DOCUMENT_REQUIRED;
        if (!number) e.idNumber = ID_OR_PASSPORT_REQUIRED;
      } else if (doc === "sa_id") {
        if (!number) e.idNumber = SA_ID_REQUIRED;
        else if (!/^\d{13}$/.test(number)) e.idNumber = SA_ID_INVALID;
      } else {
        if (!number) e.idNumber = PASSPORT_REQUIRED;
        else if (!/^[A-Z0-9]{6,20}$/.test(number)) e.idNumber = PASSPORT_INVALID;
        if (!v("idCountry")) e.idCountry = PASSPORT_COUNTRY_REQUIRED;
      }
    } else if (index === 2) {
      if (!none) {
        const clubNames = fd.getAll("clubName").map((x) => String(x).trim());
        const playerNames = fd.getAll("playerName").map((x) => String(x).trim());
        const playerClubs = fd.getAll("playerClub").map((x) => String(x).trim());
        clubNames.forEach((c, i) => {
          if (c.length > 120) e[`clubName.${i}`] = NAME_TOO_LONG;
        });
        playerNames.forEach((p, i) => {
          if (p.length > 120) e[`playerName.${i}`] = NAME_TOO_LONG;
        });
        playerClubs.forEach((c, i) => {
          if (c.length > 120) e[`playerClub.${i}`] = NAME_TOO_LONG;
          else if (c && !playerNames[i]) e[`playerName.${i}`] = PLAYER_NAME_REQUIRED;
        });
        if (![...clubNames, ...playerNames, ...playerClubs].some(Boolean)) {
          e.noAffiliations = NO_AFFILIATIONS_CHOICE;
        }
      }
    } else if (fd.get("acceptTerms") !== "yes") {
      e.acceptTerms = TERMS_REQUIRED;
    }
    return e;
  }

  /** Runs the step's checks; true when it passed. On failure focuses the first invalid field. */
  function validate(index: number): boolean {
    const e = check(index);
    setErrors((prev) => ({ ...omitStep(prev, index), ...e }));
    setSummaryStep(null);
    if (Object.keys(e).length) {
      pendingFocus.current = { step: index, invalid: true };
      return false;
    }
    return true;
  }

  function goTo(index: number) {
    setStep(index);
    pendingFocus.current = { step: index, invalid: false };
    document.title = `${STEP_TITLES[index]} · Register as a scout · Wideline`;
  }

  function onContinue() {
    if (validate(step)) goTo(step + 1);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (enhanced && step < last) {
      e.preventDefault();
      onContinue();
      return;
    }
    if (enhanced && !validate(last)) {
      e.preventDefault();
      return;
    }
    formProps.onSubmit(e);
  }

  // Enter in a text field before the last step does what Continue does.
  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    const t = e.target as HTMLElement;
    if (e.key !== "Enter" || !enhanced || step >= last) return;
    if (t instanceof HTMLInputElement && !["checkbox", "radio"].includes(t.type)) {
      e.preventDefault();
      onContinue();
    }
  }

  function chooseDocType(next: DocType) {
    setDocType(next);
    // A South African ID never stays in a passport field, or the other way round.
    if (numberRef.current) numberRef.current.value = "";
    setErrors((prev) => {
      const rest = { ...prev };
      delete rest.idNumber;
      delete rest.idDocumentType;
      return rest;
    });
  }

  function addRow(kind: "club" | "player") {
    const key = nextKey.current++;
    if (kind === "club") setClubRows([...clubs, key]);
    else setPlayerRows([...players, key]);
    pendingFocus.current = { selector: `[data-row="${kind}-${key}"] input` };
  }

  function removeRow(kind: "club" | "player", index: number) {
    const rows = kind === "club" ? clubs : players;
    const setRows = kind === "club" ? setClubRows : setPlayerRows;
    setErrors((prev) =>
      omitPrefix(prev, kind === "club" ? ["clubName"] : ["playerName", "playerClub"]),
    );
    if (rows.length === 1) {
      // With one row left, Remove clears it.
      const row = formRef.current?.querySelector(`[data-row="${kind}-${rows[0]}"]`);
      row?.querySelectorAll("input").forEach((input) => (input.value = ""));
      pendingFocus.current = { selector: `[data-row="${kind}-${rows[0]}"] input` };
      setRows([...rows]);
      return;
    }
    const focusKey = index > 0 ? rows[index - 1] : rows[1];
    setRows(rows.filter((_, i) => i !== index));
    pendingFocus.current = { selector: `[data-row="${kind}-${focusKey}"] input` };
  }

  const stepHeading = (index: number) => (
    <h2 id={`step-${index + 1}-title`} tabIndex={-1}>
      <span className="caption block text-ink-muted">
        Step {index + 1} of {total}
      </span>
      <span className="heading-2 block">{STEP_TITLES[index]}</span>
    </h2>
  );

  const summary = (index: number) =>
    summaryAt === index ? <Banner tone="danger">{FIX_FIELDS}</Banner> : null;

  const buttons = (index: number) => {
    const isLast = index === last;
    if (!enhanced && !isLast) return null;
    return (
      <>
        {isLast && <FormErrorBanner result={state} />}
        <div className="mt-2 flex gap-2 md:justify-between">
          {enhanced && index > 0 && (
            <Button
              variant="secondary"
              icon={ArrowLeft}
              block
              className="flex-1 justify-center md:flex-none"
              onClick={() => goTo(index - 1)}
            >
              Back
            </Button>
          )}
          {isLast ? (
            <SubmitButton
              block
              pendingLabel="Registering…"
              className="flex-1 justify-center md:ml-auto md:flex-none"
            >
              Register as a scout
            </SubmitButton>
          ) : (
            <Button
              variant="primary"
              block
              className="flex-1 justify-center md:ml-auto md:flex-none"
              onClick={onContinue}
            >
              Continue
            </Button>
          )}
        </div>
        {isLast && !signedIn && (
          <p className="caption mt-2 text-ink-muted">
            We email you a link to confirm your address and sign in.
          </p>
        )}
      </>
    );
  };

  const stepProps = (index: number) => ({
    id: `step-${index + 1}`,
    "aria-labelledby": `step-${index + 1}-title`,
    className: index > 0 && !enhanced ? "mt-8 flex flex-col gap-4" : "flex flex-col gap-4",
    hidden: enhanced && index !== step,
  });

  const docError = shown.idDocumentType;
  const noneError = shown.noAffiliations;
  const termsError = shown.acceptTerms;
  const numberLabel =
    docType === "sa_id"
      ? "ID number"
      : docType === "passport"
        ? "Passport number"
        : "ID or passport number";

  return (
    <>
      <p className="eyebrow mt-6 text-ink-muted">Scout registration</p>
      <h1 className="heading-1 mt-1">Register as a scout</h1>
      <p className="body mt-2 text-ink-muted">
        Scouts review matches on Wideline: they check the events our software finds and add any it
        missed. Wideline staff check every scout before they can review. It takes about 5 minutes.
      </p>
      {enhanced && (
        <div className="wl-steps mt-6" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className="wl-steps__seg"
              data-done={i < step ? "true" : undefined}
              data-current={i === step ? "true" : undefined}
            />
          ))}
        </div>
      )}

      <form
        ref={formRef}
        action={formProps.action}
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        noValidate
        className="mt-6"
      >
        <FormBusy formRef={formRef} />

        <fieldset {...stepProps(0)}>
          {stepHeading(0)}
          {summary(0)}
          <Field
            label="Your name"
            hint={
              signedIn ? "From your Wideline account." : "As it appears on your ID or passport."
            }
            error={shown.name}
          >
            {(p) =>
              signedIn ? (
                <input {...p} readOnly value={signedIn.name} className="wl-input" />
              ) : (
                <input
                  {...p}
                  name="name"
                  required
                  maxLength={120}
                  autoComplete="name"
                  className="wl-input"
                />
              )
            }
          </Field>
          <Field
            label="Email"
            hint={
              signedIn
                ? "Your scout profile is added to this account."
                : "We send your confirmation link and our decision here."
            }
            error={shown.email}
          >
            {(p) =>
              signedIn ? (
                <input {...p} type="email" readOnly value={signedIn.email} className="wl-input" />
              ) : (
                <input
                  {...p}
                  type="email"
                  name="email"
                  required
                  autoComplete="email"
                  className="wl-input"
                />
              )
            }
          </Field>
          <Field
            label="Mobile number"
            hint="South African numbers can start with 0, for example 082 123 4567. Other numbers start with + and the country code."
            error={shown.phone}
          >
            {(p) => (
              <input
                {...p}
                type="tel"
                name="phone"
                required
                autoComplete="tel"
                inputMode="tel"
                className="wl-input"
              />
            )}
          </Field>
          {buttons(0)}
        </fieldset>

        <fieldset {...stepProps(1)}>
          {stepHeading(1)}
          {summary(1)}
          <p className="body text-ink-muted">
            We use your ID or passport number once, to check that each person registers only once.
            We keep only a check value made from it, never the number itself.
          </p>
          <fieldset
            className="wl-field"
            aria-describedby={docError ? "register-doc-error" : undefined}
            data-invalid={docError ? "true" : undefined}
          >
            <legend className="label">Document</legend>
            <div className="mt-1 flex flex-col gap-3">
              {(
                [
                  ["sa_id", "South African ID", "13 digits"],
                  ["passport", "Passport", "From any country"],
                ] as const
              ).map(([value, label, hint]) => (
                <label key={value} className="wl-decision__choice body">
                  <input
                    type="radio"
                    name="idDocumentType"
                    value={value}
                    required
                    onChange={() => chooseDocType(value)}
                  />
                  <span className="min-w-0">
                    <span className="block">{label}</span>
                    <span className="caption block text-ink-muted">{hint}</span>
                  </span>
                  <Check {...iconProps} />
                </label>
              ))}
            </div>
            {docError && <FieldErrorText id="register-doc-error" message={docError} />}
          </fieldset>
          <Field
            label={numberLabel}
            hint={
              <span className="wl-inline-status">
                <LockKeyhole {...iconProps} />
                We keep only a check value, never the number.
              </span>
            }
            error={shown.idNumber}
          >
            {(p) => (
              <input
                {...p}
                ref={numberRef}
                name="idNumber"
                required
                autoComplete="off"
                spellCheck={false}
                {...(docType === "sa_id"
                  ? { inputMode: "numeric" as const, maxLength: 13 }
                  : docType === "passport"
                    ? { autoCapitalize: "characters", maxLength: 24 }
                    : { maxLength: 24 })}
                className="wl-input"
              />
            )}
          </Field>
          {(!enhanced || docType === "passport") && (
            <Field
              label={
                enhanced
                  ? "Country that issued your passport"
                  : "Country that issued your passport (passports only)"
              }
              error={shown.idCountry}
            >
              {(p) => (
                <select {...p} name="idCountry" defaultValue="" className="wl-input">
                  <option value="">Choose a country</option>
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {buttons(1)}
        </fieldset>

        <fieldset {...stepProps(2)}>
          {stepHeading(2)}
          {summary(2)}
          <p className="body text-ink-muted">
            You cannot review a match involving a club you work for, or a player you represent. Tell
            us about them now. You can change this later on your scout profile.
          </p>
          <fieldset disabled={enhanced && none} hidden={enhanced && none}>
            <legend className="body-strong mb-3">Clubs you work for or with</legend>
            <div className="wl-repeat">
              {clubs.map((key, i) => (
                <div
                  key={key}
                  className="wl-repeat__row"
                  role="group"
                  aria-label={`Club ${i + 1}`}
                  data-row={`club-${key}`}
                >
                  <Field label="Club name" error={shown[`clubName.${i}`]}>
                    {(p) => (
                      <input
                        {...p}
                        name="clubName"
                        maxLength={120}
                        autoComplete="off"
                        className="wl-input"
                      />
                    )}
                  </Field>
                  {enhanced && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      aria-label={`Remove club ${i + 1}`}
                      onClick={() => removeRow("club", i)}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {enhanced && (
              <AddRow count={clubs.length} label="Add a club" onAdd={() => addRow("club")} />
            )}
          </fieldset>
          <fieldset disabled={enhanced && none} hidden={enhanced && none}>
            <legend className="body-strong mb-3">Players you represent</legend>
            <div className="wl-repeat">
              {players.map((key, i) => (
                <div
                  key={key}
                  className="wl-repeat__row wl-repeat__row--pair"
                  role="group"
                  aria-label={`Player ${i + 1}`}
                  data-row={`player-${key}`}
                >
                  <Field label="Player name" error={shown[`playerName.${i}`]}>
                    {(p) => (
                      <input
                        {...p}
                        name="playerName"
                        maxLength={120}
                        autoComplete="off"
                        className="wl-input"
                      />
                    )}
                  </Field>
                  <Field
                    label="Their club (optional)"
                    hint="Helps us match the right player."
                    error={shown[`playerClub.${i}`]}
                  >
                    {(p) => (
                      <input
                        {...p}
                        name="playerClub"
                        maxLength={120}
                        autoComplete="off"
                        className="wl-input"
                      />
                    )}
                  </Field>
                  {enhanced && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      aria-label={`Remove player ${i + 1}`}
                      onClick={() => removeRow("player", i)}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {enhanced && (
              <AddRow count={players.length} label="Add a player" onAdd={() => addRow("player")} />
            )}
          </fieldset>
          <div className="wl-field">
            <label className="wl-choice wl-choice--top body">
              <input
                type="checkbox"
                name="noAffiliations"
                value="yes"
                aria-invalid={noneError ? true : undefined}
                aria-describedby={noneError ? "register-none-error" : undefined}
                onChange={(e) => setNone(e.currentTarget.checked)}
              />
              I have no clubs or players to declare.
            </label>
            {noneError && <FieldErrorText id="register-none-error" message={noneError} />}
          </div>
          {shown.affiliations && <Banner tone="danger">{shown.affiliations}</Banner>}
          {buttons(2)}
        </fieldset>

        <fieldset {...stepProps(3)}>
          {stepHeading(3)}
          {summary(3)}
          <p className="body text-ink-muted">
            Match footage shows players, many of them children. These terms protect them. Read them
            before you accept.
          </p>
          {terms}
          <div className="wl-field">
            <label className="wl-choice wl-choice--top body">
              <input
                type="checkbox"
                name="acceptTerms"
                value="yes"
                required
                aria-invalid={termsError ? true : undefined}
                aria-describedby={termsError ? "register-terms-error" : undefined}
              />
              I am 18 or older, and I accept the reviewer confidentiality terms.
            </label>
            {termsError && <FieldErrorText id="register-terms-error" message={termsError} />}
          </div>
          {buttons(3)}
        </fieldset>

        {/* Honeypot: hidden from people and screen readers; bots fill it in. */}
        <div className="sr-only" aria-hidden="true">
          <label htmlFor="register-website">Leave this empty</label>
          <input id="register-website" name="website" tabIndex={-1} autoComplete="off" />
        </div>
      </form>

      {!signedIn && (
        <p className="caption mt-6">
          Already have an account?{" "}
          <Link href="/login?next=/register" className="text-pitch underline">
            Sign in
          </Link>
        </p>
      )}
    </>
  );
}

function AddRow({ count, label, onAdd }: { count: number; label: string; onAdd: () => void }) {
  if (count >= MAX_AFFILIATIONS_PER_TYPE) {
    return (
      <p className="caption mt-3 text-ink-muted">
        You can add up to 30 here. Add more later on your scout profile.
      </p>
    );
  }
  return (
    <Button variant="ghost" icon={Plus} className="mt-3" onClick={onAdd}>
      {label}
    </Button>
  );
}
