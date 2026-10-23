"use client";

import type { LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, type ButtonVariant } from "@/components/ui/Button";
import type { ActionResult } from "@/lib/action-result";
import { FormErrorBanner, SubmitButton } from "./forms";
import type { SectionForm } from "./section-result";

/**
 * A confirmation in a native modal <dialog> (docs/build/design/C01.md,
 * "ConfirmDialog"). The trigger opens it; the dialog wraps a form posting to a
 * section-level action (useSectionAction), so the section shows the success
 * banner even when the action removes this row. On success the dialog closes;
 * on error it stays open and shows the error.
 * Focus starts on the first field, or on Cancel when there is none, so a
 * stray Enter never destroys anything.
 */
export function ConfirmDialog({
  trigger,
  title,
  body,
  form,
  hidden,
  submit,
  children,
}: {
  trigger: { label: string; variant: ButtonVariant; icon?: LucideIcon; ariaLabel?: string };
  title: string;
  body: ReactNode;
  form: SectionForm;
  hidden: Record<string, string>;
  submit: { label: string; pendingLabel: string; variant: "primary" | "danger" };
  /** Fields. A function gets the result on screen, for field errors (C02 reason fields). */
  children?: ReactNode | ((visible: ActionResult) => ReactNode);
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const { state, formProps } = form;
  // The result that was on screen when the dialog last opened, so a reopened
  // dialog does not show a stale error.
  const [dismissed, setDismissed] = useState<ActionResult>(null);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (state?.ok) dialogRef.current?.close();
  }, [state]);

  function open() {
    setDismissed(state);
    setFormKey((k) => k + 1);
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    requestAnimationFrame(() => {
      const field = dialog.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea");
      (field ?? cancelRef.current)?.focus();
    });
  }

  const visible = state !== dismissed ? state : null;

  return (
    <>
      <Button
        variant={trigger.variant}
        size="sm"
        icon={trigger.icon}
        aria-label={trigger.ariaLabel}
        onClick={open}
      >
        {trigger.label}
      </Button>
      <dialog
        ref={dialogRef}
        className="wl-dialog"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <h2 id={titleId} className="heading-2">
          {title}
        </h2>
        <div id={bodyId} className="body mt-2 text-ink-muted">
          {body}
        </div>
        {/* noValidate: required fields get the server's copy (C02 suspension reason), not a browser tooltip. */}
        <form key={formKey} {...formProps} noValidate className="mt-4 flex flex-col gap-4">
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {typeof children === "function" ? children(visible) : children}
          <FormErrorBanner result={visible} />
          <div className="wl-dialog__actions">
            <Button ref={cancelRef} variant="secondary" onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
            <SubmitButton variant={submit.variant} pendingLabel={submit.pendingLabel}>
              {submit.label}
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
