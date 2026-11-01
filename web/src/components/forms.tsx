"use client";

import { CircleAlert, CircleCheck, Clock, type LucideIcon } from "lucide-react";
import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useState,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { useFormStatus } from "react-dom";
import {
  Button,
  type ButtonSize,
  type ButtonVariant,
  type LegacyButtonSize,
} from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icons";
import type { ActionResult } from "@/lib/action-result";

// Form pieces shared by the C01 screens (docs/build/design/C01.md, "Server
// action results"). Forms use useActionState; these read its result.

/**
 * useActionState for a form with fields. React resets a form after its action
 * runs, which would wipe what someone typed when the server returns a field
 * error. Submitting from onSubmit inside a transition keeps the values, and
 * useFormStatus still reports pending. `action` stays on the form, so it still
 * posts without JavaScript.
 */
export function useFormAction<S>(
  action: (prev: Awaited<S>, formData: FormData) => Promise<S>,
  initial: Awaited<S>,
) {
  const [state, dispatch, pending] = useActionState<S, FormData>(action, initial);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(
      e.currentTarget,
      (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null,
    );
    startTransition(() => dispatch(formData));
  };
  return { state, pending, formProps: { action: dispatch, onSubmit } };
}

/**
 * useFormAction for a form with a second submit button that posts to another
 * action (docs/build/design/C03.md: Save and Use plan default share one form).
 * Give that button `formAction={alternateAction}`; onSubmit dispatches to it
 * when it is the submitter. Without JavaScript the native formaction attribute
 * does the same. `state` is the result of whichever action answered last, and
 * `lastWasAlternate` says which.
 */
export function useFormActionWithAlternate<S>(
  action: (prev: Awaited<S>, formData: FormData) => Promise<S>,
  alternate: (prev: Awaited<S>, formData: FormData) => Promise<S>,
  initial: Awaited<S>,
) {
  const [mainState, mainDispatch, mainPending] = useActionState<S, FormData>(action, initial);
  const [altState, altDispatch, altPending] = useActionState<S, FormData>(alternate, initial);
  const [lastWasAlternate, setLastWasAlternate] = useState(false);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const formData = new FormData(e.currentTarget, submitter);
    const alt = submitter?.dataset.alternate === "true";
    setLastWasAlternate(alt);
    startTransition(() => (alt ? altDispatch : mainDispatch)(formData));
  };
  return {
    state: lastWasAlternate ? altState : mainState,
    lastWasAlternate,
    pending: mainPending || altPending,
    formProps: { action: mainDispatch, onSubmit },
    alternateAction: altDispatch,
  };
}

/**
 * A submit button that shows the loading state while its form's action runs: a spinner
 * replaces the icon, the label becomes pendingLabel and the width stays. Clicks are
 * ignored while it is pending.
 */
export function SubmitButton({
  variant = "primary",
  size,
  icon,
  block,
  pendingLabel,
  className,
  children,
  pending: pendingProp = false,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize | LegacyButtonSize;
  icon?: LucideIcon;
  block?: boolean;
  pendingLabel: string;
  className?: string;
  children: ReactNode;
  /** useActionState's isPending, for a form dispatched from onSubmit (useFormAction). */
  pending?: boolean;
  "aria-label"?: string;
  ref?: Ref<HTMLButtonElement>;
  /**
   * Posts to another action than the form's (useFormActionWithAlternate). The
   * button is marked data-alternate so that hook's onSubmit picks it.
   */
  formAction?: ComponentProps<"button">["formAction"];
}) {
  const status = useFormStatus();
  const pending = status.pending || pendingProp;
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      icon={icon}
      block={block}
      className={className}
      loading={pending}
      loadingLabel={pendingLabel}
      data-alternate={rest.formAction ? "true" : undefined}
      {...rest}
    >
      {children}
    </Button>
  );
}

/** Sets aria-busy on the surrounding form while its action runs. Render inside the form. */
export function FormBusy({ formRef }: { formRef: RefObject<HTMLFormElement | null> }) {
  const { pending } = useFormStatus();
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    if (pending) form.setAttribute("aria-busy", "true");
    else form.removeAttribute("aria-busy");
  }, [pending, formRef]);
  return null;
}

/** Moves focus to the first invalid field after a result with field errors. */
export function useFocusFirstInvalid(
  /** Usually the form; any container of the fields works (C09 calibration points list). */
  formRef: RefObject<HTMLElement | null>,
  state: ActionResult,
) {
  useEffect(() => {
    if (state && !state.ok && state.fieldErrors && Object.keys(state.fieldErrors).length) {
      // A radio group marks its fieldset with data-invalid (radios do not take aria-invalid).
      formRef.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"] input')
        ?.focus();
    }
  }, [state, formRef]);
}

type ControlProps = {
  id: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
};

/**
 * A labelled form field: label, control, hint and error, in that DOM order. The
 * control gets its id, aria-invalid and aria-describedby from the render prop; give it
 * the class wl-input. New code: prefer TextField, TextArea, Select and SearchSelect
 * (components/ui/TextField), which draw the Floodlight field with its icons.
 */
export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  /** Usually a string; a node allows a hidden suffix ("<span class=sr-only>for Scout search</span>"). */
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: (props: ControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");
  return (
    <div className={className ? `wl-field ${className}` : "wl-field"}>
      <label htmlFor={id} className="wl-field__label">
        {label}
      </label>
      {children({
        id,
        ...(error && { "aria-invalid": true as const }),
        ...(describedBy && { "aria-describedby": describedBy }),
      })}
      {hint && (
        <p id={hintId} className="wl-field__hint">
          {hint}
        </p>
      )}
      {error && <FieldErrorText id={errorId} message={error} />}
    </div>
  );
}

export function FieldErrorText({ id, message }: { id?: string; message: string }) {
  return (
    <p id={id} className="wl-field__error">
      <CircleAlert {...iconProps} />
      <span>{message}</span>
    </p>
  );
}

/** A success (ok), partial success (warn) or error (danger) banner. */
export function Banner({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "danger";
  children: ReactNode;
}) {
  const Icon = tone === "ok" ? CircleCheck : tone === "warn" ? Clock : CircleAlert;
  const cls =
    tone === "ok"
      ? "wl-banner wl-banner--ok"
      : tone === "danger"
        ? "wl-banner wl-banner--danger"
        : "wl-banner";
  return (
    <div className={cls} role={tone === "danger" ? "alert" : "status"}>
      <Icon {...iconProps} />
      <p className="text-body">{children}</p>
    </div>
  );
}

/** The success banner for a result, if it is a success. */
export function SuccessBanner({ result }: { result: ActionResult }) {
  if (!result?.ok) return null;
  return <Banner tone={result.tone ?? "ok"}>{result.message}</Banner>;
}

/** The form-level error banner for a result, if it has one. */
export function FormErrorBanner({ result }: { result: ActionResult }) {
  if (!result || result.ok || !result.formError) return null;
  return <Banner tone="danger">{result.formError}</Banner>;
}

export function fieldError(result: ActionResult, name: string): string | undefined {
  return result && !result.ok ? result.fieldErrors?.[name] : undefined;
}
