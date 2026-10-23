"use client";

import { CircleAlert, CircleCheck, Clock, type LucideIcon } from "lucide-react";
import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonVariant } from "@/components/ui/Button";
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

/** A submit button that disables itself and shows pendingLabel while its form's action runs. */
export function SubmitButton({
  variant = "primary",
  size,
  icon,
  block,
  pendingLabel,
  className,
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  icon?: LucideIcon;
  block?: boolean;
  pendingLabel: string;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      icon={icon}
      block={block}
      className={className}
      disabled={pending}
      {...rest}
    >
      {pending ? pendingLabel : children}
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
  formRef: RefObject<HTMLFormElement | null>,
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
 * control gets its id, aria-invalid and aria-describedby from the render prop.
 */
export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
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
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children({
        id,
        ...(error && { "aria-invalid": true as const }),
        ...(describedBy && { "aria-describedby": describedBy }),
      })}
      {hint && (
        <p id={hintId} className="wl-field__hint caption">
          {hint}
        </p>
      )}
      {error && <FieldErrorText id={errorId} message={error} />}
    </div>
  );
}

export function FieldErrorText({ id, message }: { id?: string; message: string }) {
  return (
    <p id={id} className="wl-field__error caption">
      <CircleAlert {...iconProps} />
      {message}
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
      <p className="body">{children}</p>
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
