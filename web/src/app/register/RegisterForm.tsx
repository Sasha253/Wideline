"use client";

import {
  ArrowLeft,
  Check,
  ChevronRight,
  Clock,
  Info,
  LockKeyhole,
  Plus,
  Trash2,
} from "lucide-react";
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
import { Button, ButtonLink } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { iconProps } from "@/components/ui/icons";
import { Logo, LogoMark } from "@/components/ui/Logo";
import { StatusChip } from "@/components/ui/StatusChip";
import { StepHeader } from "@/components/ui/StepHeader";
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

// Scout registration (Floodlight, "Scout registration"): one form, one fieldset per step,
// one topic each, posted once. With JavaScript one step shows at a time, with the steps in
// a sidebar on desktop and "1 of 4" plus bars on phones; without it every step shows
// stacked and the server checks everything. There is no password step: signed out, the
// account opens through the emailed confirmation link, and the scout sets a password on
// /scout after that.

const STEPS = [
  {
    label: "Identity",
    sub: "Name and ID number",
    title: "Who are you?",
  },
  {
    label: "Contact",
    sub: "Email and mobile",
    title: "How can we reach you?",
  },
  {
    label: "Clubs",
    sub: "Clubs you are connected to",
    title: "Are you connected to any clubs?",
  },
  {
    label: "Terms",
    sub: "How scouts use Wideline",
    title: "How scouts use Wideline",
  },
] as const;

const FIX_FIELDS = "Some details need fixing. Check the highlighted fields.";
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** 48px fields on phones, 40px from 768px (Floodlight registration). */
const INPUT = "wl-input h-12 tablet:h-10";

/** The step (0-based) that holds a field error key such as "playerName.2". */
function stepOfKey(key: string): number {
  const head = key.split(".")[0]!;
  if (["name", "idDocumentType", "idNumber", "idCountry"].includes(head)) return 0;
  if (["email", "phone"].includes(head)) return 1;
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
  const total = STEPS.length;
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

  // The sidebar title is the page heading, except on the result screen, which has its own.
  // Below 992px the mark, the title and "1 of 4 · Identity" share one row, bars under it;
  // only one of the two titles is ever displayed.
  const header = (current: number | null, heading = true) => {
    const Title = heading ? "h1" : "p";
    const home = (children: ReactNode, className?: string) => (
      <Link
        href="/"
        aria-label="Wideline home"
        className={cx("flex items-center self-start text-ink no-underline", className)}
      >
        {children}
      </Link>
    );
    return (
      <aside className="border-b border-line bg-panel px-5 py-4 desktop:flex desktop:w-90 desktop:flex-none desktop:flex-col desktop:border-r desktop:border-b-0 desktop:px-8 desktop:py-10">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 desktop:hidden [&_.wl-stepbar]:contents [&_.wl-stepbar>:last-child]:col-span-2">
          {heading ? (
            <span className="flex min-w-0 items-center gap-2.5">
              {home(<LogoMark size="s" />, "flex-none")}
              <Title className="m-0 min-w-0 truncate text-body font-semibold">Apply to scout</Title>
            </span>
          ) : (
            home(<Logo size="m" />)
          )}
          {current !== null && (
            <StepHeader
              steps={STEPS.map((s) => s.label)}
              current={current + 1}
              compact="always"
              className="contents"
            />
          )}
        </div>
        <div className="hidden desktop:flex desktop:flex-1 desktop:flex-col desktop:gap-9">
          {home(<Logo size="m" />)}
          <div className="flex flex-col gap-2.5">
            <Title className="m-0 font-display text-title-m font-extrabold uppercase stretch-wide">
              Apply to scout
            </Title>
            <p className="m-0 text-ink-muted">About 6 minutes.</p>
          </div>
          {current !== null && (
            <StepHeader
              steps={STEPS.map((s) => ({ label: s.label, sub: s.sub }))}
              current={current + 1}
              layout="column"
              compact="never"
              label="Registration steps"
            />
          )}
          <p className="m-0 mt-auto text-body-s text-ink-muted">
            Questions?{" "}
            <a href="mailto:scouts@wideline.co.za" className="text-brand-text">
              scouts@wideline.co.za
            </a>
          </p>
        </div>
      </aside>
    );
  };

  if (state?.ok) {
    return (
      <div className="min-h-dvh desktop:flex">
        {header(null, false)}
        <div className="flex flex-1 flex-col px-5 pt-12 pb-10 tablet:px-10 desktop:px-20 desktop:pt-14">
          <div className="flex max-w-150 flex-col gap-4.5">
            {signedIn && (
              <span className="self-start">
                <StatusChip tone="warn" icon={Clock} label="Waiting for review" />
              </span>
            )}
            <h1 ref={receivedRef} tabIndex={-1} className="m-0 text-title-guardian stretch-semi">
              {signedIn ? "Application sent" : "Check your email"}
            </h1>
            <p className="m-0 text-body-guardian text-pretty">
              {signedIn
                ? `We check your ID and the clubs you told us about, then email ${signedIn.email} with the answer.`
                : state.message}
            </p>
            <div className="flex gap-3 border-y border-line py-3.5 text-ink-muted">
              <Info {...iconProps} className="mt-0.5 flex-none text-ink" />
              {signedIn ? (
                <span>Until then you can sign in, but you can&apos;t see players or matches.</span>
              ) : (
                <span>
                  No email after a few minutes? Check your spam folder, or{" "}
                  <Link href="/login?next=/scout" className="text-brand-text">
                    sign in
                  </Link>{" "}
                  with Email me a sign-in link.
                </span>
              )}
            </div>
            <ButtonLink
              variant="secondary"
              size="xl"
              href="/"
              className="justify-center tablet:h-control-l tablet:self-start"
            >
              Close
            </ButtonLink>
          </div>
        </div>
      </div>
    );
  }

  // Without JavaScript the errors come straight from the action result.
  const serverErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const shown = enhanced ? errors : serverErrors;
  const serverFirst = Object.keys(serverErrors).length
    ? Math.min(...Object.keys(serverErrors).map(stepOfKey))
    : null;
  const summaryAt = enhanced ? summaryStep : serverFirst;

  /** The client checks of one step. */
  function check(index: number): Record<string, string> {
    const fd = new FormData(formRef.current!);
    const v = (n: string) => String(fd.get(n) ?? "").trim();
    const e: Record<string, string> = {};
    if (index === 0) {
      if (!signedIn) {
        const name = v("name");
        if (!name) e.name = SCOUT_NAME_REQUIRED;
        else if (name.length > 120) e.name = NAME_TOO_LONG;
      }
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
    } else if (index === 1) {
      if (!signedIn && !EMAIL_SHAPE.test(v("email"))) e.email = EMAIL_ERROR;
      if (!v("phone")) e.phone = PHONE_REQUIRED;
      else if (!normalisePhone(v("phone"))) e.phone = PHONE_INVALID;
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
    document.title = `${STEPS[index]!.label} · Apply to scout · Wideline`;
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

  const stepHeading = (index: number, explainer?: ReactNode) => (
    <div className="flex flex-col gap-3">
      <h2 id={`step-${index + 1}-title`} tabIndex={-1} className="m-0 flex flex-col gap-3">
        <span className="font-mono text-overline uppercase text-ink-muted">
          {`Step ${index + 1} of ${total}`}
        </span>
        <span className="text-title-guardian stretch-semi">{STEPS[index]!.title}</span>
      </h2>
      {explainer && (
        <p className="m-0 max-w-150 text-body-guardian text-pretty text-ink-muted">{explainer}</p>
      )}
    </div>
  );

  const summary = (index: number) =>
    summaryAt === index ? <Banner tone="danger">{FIX_FIELDS}</Banner> : null;

  const buttons = (index: number) => {
    const isLast = index === last;
    if (!enhanced && !isLast) return null;
    const prev = index > 0 ? STEPS[index - 1]!.label : null;
    const next = !isLast ? STEPS[index + 1]!.label : null;
    return (
      <>
        {isLast && <FormErrorBanner result={state} />}
        <div className="mt-4 flex items-center gap-2 border-t border-line pt-5 tablet:gap-3">
          {enhanced && prev && (
            <Button
              variant="secondary"
              size="xl"
              icon={ArrowLeft}
              aria-label={`Back to ${prev.toLowerCase()}`}
              className="w-14 flex-none justify-center px-0 tablet:h-control-l tablet:w-auto tablet:px-4"
              onClick={() => goTo(index - 1)}
            >
              <span className="hidden tablet:inline">{prev}</span>
            </Button>
          )}
          {isLast ? (
            <SubmitButton
              size="xl"
              pendingLabel="Sending"
              className="flex-1 justify-center tablet:ml-auto tablet:h-control-l tablet:flex-none"
            >
              Send application
            </SubmitButton>
          ) : (
            <Button
              variant="primary"
              size="xl"
              className="flex-1 justify-center tablet:ml-auto tablet:h-control-l tablet:flex-none"
              onClick={onContinue}
            >
              Continue
              <span className="hidden tablet:inline">&nbsp;to {next!.toLowerCase()}</span>
              <ChevronRight {...iconProps} />
            </Button>
          )}
        </div>
        {isLast && !signedIn && (
          <p className="m-0 text-body-s text-ink-muted">
            We email you a link to confirm your address and sign in.
          </p>
        )}
      </>
    );
  };

  const stepProps = (index: number) => ({
    id: `step-${index + 1}`,
    "aria-labelledby": `step-${index + 1}-title`,
    className: cx(
      "m-0 flex min-w-0 flex-col gap-4.5 border-0 p-0",
      index > 0 && !enhanced && "mt-12",
    ),
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
    <div className="min-h-dvh desktop:flex">
      {header(enhanced ? step : null)}
      <div className="flex min-w-0 flex-1 flex-col px-5 pt-6 pb-10 tablet:px-10 desktop:px-20 desktop:pt-14">
        <form
          ref={formRef}
          action={formProps.action}
          onSubmit={onSubmit}
          onKeyDown={onKeyDown}
          noValidate
          className="flex max-w-150 flex-col"
        >
          <FormBusy formRef={formRef} />

          <fieldset {...stepProps(0)}>
            {stepHeading(
              0,
              "Use your name as it appears on your ID. We check it before you can review matches.",
            )}
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
                  <input {...p} readOnly value={signedIn.name} className={INPUT} />
                ) : (
                  <input
                    {...p}
                    name="name"
                    required
                    maxLength={120}
                    autoComplete="name"
                    className={INPUT}
                  />
                )
              }
            </Field>
            <fieldset
              className="wl-field m-0 border-0 p-0"
              aria-describedby={docError ? "register-doc-error" : undefined}
              data-invalid={docError ? "true" : undefined}
            >
              <legend className="wl-field__label mb-1.5">Document</legend>
              <div className="flex flex-col gap-3">
                {(
                  [
                    ["sa_id", "South African ID", "13 digits"],
                    ["passport", "Passport", "From any country"],
                  ] as const
                ).map(([value, label, hint]) => (
                  <label key={value} className="wl-decision__choice">
                    <input
                      type="radio"
                      name="idDocumentType"
                      value={value}
                      required
                      onChange={() => chooseDocType(value)}
                    />
                    <span className="min-w-0">
                      <span className="block">{label}</span>
                      <span className="wl-decision__hint">{hint}</span>
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
                  className={cx(INPUT, "wl-mono tracking-wide")}
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
                  <select {...p} name="idCountry" defaultValue="" className={INPUT}>
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
            {buttons(0)}
          </fieldset>

          <fieldset {...stepProps(1)}>
            {stepHeading(1)}
            {summary(1)}
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
                  <input {...p} type="email" readOnly value={signedIn.email} className={INPUT} />
                ) : (
                  <input
                    {...p}
                    type="email"
                    name="email"
                    required
                    autoComplete="email"
                    className={INPUT}
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
                  className={cx(INPUT, "wl-mono")}
                />
              )}
            </Field>
            {buttons(1)}
          </fieldset>

          <fieldset {...stepProps(2)}>
            {stepHeading(
              2,
              "Tell us about any club you work for, coach at, or have family playing at, and any player you represent. You won't be asked to review their matches. This keeps every review fair.",
            )}
            {summary(2)}
            <fieldset
              disabled={enhanced && none}
              hidden={enhanced && none}
              className="m-0 border border-line bg-panel p-0"
            >
              <legend className="sr-only">Clubs you work for or with</legend>
              <p
                className="m-0 border-b border-line px-4 pt-3.5 pb-3 font-semibold"
                aria-hidden="true"
              >
                Clubs you work for or with
              </p>
              {clubs.map((key, i) => (
                <div
                  key={key}
                  className="flex flex-col gap-2 border-b border-line bg-raised p-4 tablet:flex-row tablet:items-end tablet:gap-3"
                  role="group"
                  aria-label={`Club ${i + 1}`}
                  data-row={`club-${key}`}
                >
                  <Field label="Club name" error={shown[`clubName.${i}`]} className="flex-1">
                    {(p) => (
                      <input
                        {...p}
                        name="clubName"
                        maxLength={120}
                        autoComplete="off"
                        className={INPUT}
                      />
                    )}
                  </Field>
                  {enhanced && (
                    <RemoveRow
                      label={`Remove club ${i + 1}`}
                      onClick={() => removeRow("club", i)}
                    />
                  )}
                </div>
              ))}
              {enhanced && (
                <AddRow
                  count={clubs.length}
                  label="Add another club"
                  onAdd={() => addRow("club")}
                />
              )}
            </fieldset>
            <fieldset
              disabled={enhanced && none}
              hidden={enhanced && none}
              className="m-0 border border-line bg-panel p-0"
            >
              <legend className="sr-only">Players you represent</legend>
              <p
                className="m-0 border-b border-line px-4 pt-3.5 pb-3 font-semibold"
                aria-hidden="true"
              >
                Players you represent
              </p>
              {players.map((key, i) => (
                <div
                  key={key}
                  className="flex flex-col gap-2 border-b border-line bg-raised p-4 tablet:flex-row tablet:items-start tablet:gap-3"
                  role="group"
                  aria-label={`Player ${i + 1}`}
                  data-row={`player-${key}`}
                >
                  <Field label="Player name" error={shown[`playerName.${i}`]} className="flex-1">
                    {(p) => (
                      <input
                        {...p}
                        name="playerName"
                        maxLength={120}
                        autoComplete="off"
                        className={INPUT}
                      />
                    )}
                  </Field>
                  <Field
                    label="Their club (optional)"
                    hint="Helps us match the right player."
                    error={shown[`playerClub.${i}`]}
                    className="flex-1"
                  >
                    {(p) => (
                      <input
                        {...p}
                        name="playerClub"
                        maxLength={120}
                        autoComplete="off"
                        className={INPUT}
                      />
                    )}
                  </Field>
                  {enhanced && (
                    <RemoveRow
                      label={`Remove player ${i + 1}`}
                      onClick={() => removeRow("player", i)}
                      className="tablet:mt-5"
                    />
                  )}
                </div>
              ))}
              {enhanced && (
                <AddRow
                  count={players.length}
                  label="Add a player"
                  onAdd={() => addRow("player")}
                />
              )}
            </fieldset>
            <div className="wl-field">
              <label className="flex min-h-control-l cursor-pointer items-center gap-3 text-body">
                <input
                  type="checkbox"
                  name="noAffiliations"
                  value="yes"
                  className="size-5 flex-none accent-ink"
                  aria-invalid={noneError ? true : undefined}
                  aria-describedby={noneError ? "register-none-error" : undefined}
                  onChange={(e) => setNone(e.currentTarget.checked)}
                />
                I&apos;m not connected to any club or player.
              </label>
              {noneError && <FieldErrorText id="register-none-error" message={noneError} />}
            </div>
            {shown.affiliations && <Banner tone="danger">{shown.affiliations}</Banner>}
            {buttons(2)}
          </fieldset>

          <fieldset {...stepProps(3)}>
            {stepHeading(
              3,
              "Match footage shows players, many of them children. These terms protect them. Read them before you accept.",
            )}
            {summary(3)}
            {terms}
            <div className="wl-field">
              <label
                className={cx(
                  "flex min-h-control-xl cursor-pointer items-center gap-3.5 rounded-control border px-3.5 py-2 font-semibold",
                  termsError ? "border-rejected" : "border-ink",
                )}
              >
                <input
                  type="checkbox"
                  name="acceptTerms"
                  value="yes"
                  required
                  className="size-6 flex-none accent-ink"
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
          <p className="m-0 mt-8 text-body-s text-ink-muted">
            Already have an account?{" "}
            <Link href="/login?next=/register" className="text-brand-text">
              Sign in
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

function RemoveRow({
  label,
  onClick,
  className,
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="m"
      icon={Trash2}
      aria-label={label}
      className={cx("self-end", className)}
      onClick={onClick}
    >
      Remove
    </Button>
  );
}

function AddRow({ count, label, onAdd }: { count: number; label: string; onAdd: () => void }) {
  if (count >= MAX_AFFILIATIONS_PER_TYPE) {
    return (
      <p className="m-0 px-4 py-3 text-body-s text-ink-muted">
        You can add up to 30 here. Add more later on your scout profile.
      </p>
    );
  }
  return (
    <div className="px-2 py-1.5">
      <Button variant="ghost" icon={Plus} className="text-brand-text" onClick={onAdd}>
        {label}
      </Button>
    </div>
  );
}
