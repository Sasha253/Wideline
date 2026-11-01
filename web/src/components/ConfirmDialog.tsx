"use client";

import type { LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Button,
  type ButtonSize,
  type ButtonVariant,
  type LegacyButtonSize,
} from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { iconProps } from "@/components/ui/icons";
import { trapTab } from "@/components/ui/Modal";
import type { ActionResult } from "@/lib/action-result";
import { FormErrorBanner, SubmitButton } from "./forms";
import type { SectionForm } from "./section-result";

/**
 * A confirmation in a native modal <dialog> (docs/build/design/C01.md, "ConfirmDialog";
 * Floodlight "Modal", confirm dialog). The trigger opens it; the dialog wraps a form
 * posting to a section-level action (useSectionAction), so the section shows the success
 * banner even when the action removes this row. On success the dialog closes; on error
 * it stays open and shows the error.
 *
 * The title names the action ("Delete this upload?"); the submit button is named for its
 * result ("Delete upload"). Focus starts on the first field, or on the safe button when
 * there is none, so a stray Enter never destroys anything; it stays inside, Esc closes,
 * and focus returns to the trigger. A danger submit makes it an alertdialog. A bottom
 * sheet below 768px. For a dialog without a form, use ConfirmModal (components/ui/Modal).
 */
export function ConfirmDialog({
  trigger,
  title,
  body,
  icon: Icon,
  form,
  hidden,
  submit,
  cancelLabel = "Cancel",
  closeOnError = false,
  children,
}: {
  trigger: {
    label: string;
    variant: ButtonVariant;
    icon?: LucideIcon;
    ariaLabel?: string;
    /** Full width on phones, as a row of page actions (C05 consent section). */
    block?: boolean;
    /** s (32px) by default: row actions. */
    size?: ButtonSize | LegacyButtonSize;
    /** Extra classes on the trigger, such as text-rejected for a Reject row action. */
    className?: string;
  };
  title: string;
  body: ReactNode;
  /** 22px above the title, rejected for a danger submit (Trash2 for a delete). */
  icon?: LucideIcon;
  form: SectionForm;
  hidden: Record<string, string>;
  submit: {
    label: string;
    pendingLabel: string;
    variant: "primary" | "danger";
    icon?: LucideIcon;
  };
  /** The safe button. Name it where it helps: "Keep upload". */
  cancelLabel?: string;
  /**
   * Close on an error too, when the caller shows it on the page instead (C09
   * calibration: the point fields the server marks are behind the dialog).
   */
  closeOnError?: boolean;
  /** Fields. A function gets the result on screen, for field errors (C02 reason fields). */
  children?: ReactNode | ((visible: ActionResult) => ReactNode);
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const { state, pending, formProps } = form;
  // The result that was on screen when the dialog last opened, so a reopened
  // dialog does not show a stale error.
  const [dismissed, setDismissed] = useState<ActionResult>(null);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (state?.ok || (closeOnError && state)) dialogRef.current?.close();
  }, [state, closeOnError]);

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
  const danger = submit.variant === "danger";

  return (
    <>
      <Button
        ref={triggerRef}
        variant={trigger.variant}
        size={trigger.size ?? "s"}
        icon={trigger.icon}
        aria-label={trigger.ariaLabel}
        block={trigger.block}
        className={trigger.className}
        onClick={open}
      >
        {trigger.label}
      </Button>
      <dialog
        ref={dialogRef}
        role={danger ? "alertdialog" : undefined}
        className="wl-modal wl-modal--confirm"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={trapTab}
        onClose={() => {
          // The row may be gone after a success; then focus falls back to the page.
          if (triggerRef.current?.isConnected) triggerRef.current.focus();
        }}
      >
        <div className="wl-modal__grab" aria-hidden="true" />
        {/* noValidate: required fields get the server's copy (C02 suspension reason), not a browser tooltip. */}
        <form key={formKey} {...formProps} noValidate aria-busy={pending || undefined}>
          <div className="wl-modal__confirm">
            {Icon && (
              <Icon {...iconProps} className={cx("wl-modal__icon", danger && "text-rejected")} />
            )}
            <h2 id={titleId} className="wl-modal__title">
              {title}
            </h2>
            <div id={bodyId} className="wl-modal__text">
              {body}
            </div>
            {Object.entries(hidden).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            {children !== undefined && (
              <div className="wl-modal__fields">
                {typeof children === "function" ? children(visible) : children}
              </div>
            )}
            <FormErrorBanner result={visible} />
          </div>
          <div className="wl-modal__actions">
            <Button ref={cancelRef} variant="secondary" onClick={() => dialogRef.current?.close()}>
              {cancelLabel}
            </Button>
            <SubmitButton
              variant={submit.variant}
              icon={submit.icon}
              pendingLabel={submit.pendingLabel}
              pending={pending}
            >
              {submit.label}
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
