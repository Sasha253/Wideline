"use client";

import { X, type LucideIcon } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Button } from "./Button";
import { cx } from "./cx";
import { iconProps } from "./icons";

/*
 * Modal, Sheet and ConfirmModal (Floodlight, "Modal" in design/Wideline Components.dc.html).
 *
 * - A form dialog collects a short task without losing your place (add a missed event
 *   while the video is paused). Up to 5 fields. Buttons are named for their result
 *   ("Add event", "Delete upload"), never "OK". In review, show the keyboard shortcuts in
 *   the footer (`footerHint`).
 * - A confirm dialog guards anything that can't be undone; its title names the action
 *   ("Delete this upload?"). Danger buttons belong only here.
 * - Focus moves to the first field (in a confirm dialog, to the safe button), stays
 *   trapped inside, and returns to the trigger on close. Esc closes. On phones both
 *   become bottom sheets. No stacked dialogs, and never guardian consent in a dialog.
 */

const FIELD =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab and Shift+Tab inside the dialog (the page behind is already inert). */
export function trapTab(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "Tab") return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest("[hidden]") && el.getClientRects().length > 0,
  );
  if (items.length === 0) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Opens and closes a native modal <dialog> from `open`, puts focus on `initialFocus` (or
 * the first field, or `fallbackFocus`), and returns focus to the trigger on close. Esc
 * closes the dialog natively; onClose then tells the parent.
 */
function useModalDialog(
  open: boolean,
  onClose: () => void,
  initialFocus: RefObject<HTMLElement | null> | undefined,
  fallbackFocus: RefObject<HTMLElement | null>,
) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const closingFromProp = useRef(false);
  const latestOnClose = useRef(onClose);

  useEffect(() => {
    latestOnClose.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnTo.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      const target =
        initialFocus?.current ??
        dialog.querySelector<HTMLElement>(FIELD) ??
        fallbackFocus.current ??
        dialog;
      target.focus();
    } else if (!open && dialog.open) {
      closingFromProp.current = true;
      dialog.close();
    }
  }, [open, initialFocus, fallbackFocus]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const restore = () => {
      const el = returnTo.current;
      returnTo.current = null;
      if (el && el.isConnected) el.focus();
    };
    const onNativeClose = () => {
      restore();
      if (!closingFromProp.current) latestOnClose.current();
      closingFromProp.current = false;
    };
    dialog.addEventListener("close", onNativeClose);
    return () => {
      dialog.removeEventListener("close", onNativeClose);
      if (dialog.open) {
        dialog.close();
        restore();
      }
    };
  }, []);

  return ref;
}

type ModalProps = {
  open: boolean;
  /** Called on Esc, the close button and Cancel. Set `open` to false in it. */
  onClose: () => void;
  /** Names the task or the action: "Add missed event". */
  title: string;
  /** Mono meta under the title: "Video paused at 31:24". */
  subtitle?: ReactNode;
  children?: ReactNode;
  /** The buttons, right-aligned: Cancel (secondary) then the primary. */
  footer?: ReactNode;
  /** Left of the buttons: keyboard hints, e.g. <Kbd>Enter</Kbd> add <Kbd>Esc</Kbd> cancel. */
  footerHint?: ReactNode;
  /** Where focus starts. Default: the first field, else the close button. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** "Close" by default. */
  closeLabel?: string;
  className?: string;
  bodyClassName?: string;
};

function ModalFrame({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  footerHint,
  initialFocus,
  closeLabel = "Close",
  className,
  bodyClassName,
  sheet,
}: ModalProps & { sheet: boolean }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const ref = useModalDialog(open, onClose, initialFocus, closeRef);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={cx("wl-modal", sheet && "wl-modal--sheet", className)}
      onKeyDown={trapTab}
    >
      <div className="wl-modal__grab" aria-hidden="true" />
      <div className="wl-modal__head">
        <div className="wl-modal__heading">
          <h2 id={titleId} className="wl-modal__title">
            {title}
          </h2>
          {subtitle && <p className="wl-modal__sub">{subtitle}</p>}
        </div>
        <button
          ref={closeRef}
          type="button"
          className="wl-modal__close"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={onClose}
        >
          <X {...iconProps} />
        </button>
      </div>
      <div className={cx("wl-modal__body", bodyClassName)}>{children}</div>
      {(footer || footerHint) && (
        <div className="wl-modal__foot">
          <div className="wl-modal__hint">{footerHint}</div>
          {footer}
        </div>
      )}
    </dialog>
  );
}

/** A form dialog, 480px wide; a bottom sheet below 768px. */
export function Modal(props: ModalProps) {
  return <ModalFrame {...props} sheet={false} />;
}

/** A bottom sheet at every width (phone review actions, edit event). 480px wide from 768px. */
export function Sheet(props: ModalProps) {
  return <ModalFrame {...props} sheet />;
}

/**
 * A controlled confirm dialog (role="alertdialog"), 400px wide: icon, a title that names
 * the action, one paragraph, then the safe button and the action. Focus starts on the
 * safe button, so a stray Enter never destroys anything. For a form posting to a server
 * action, use ConfirmDialog in components/ConfirmDialog.tsx.
 */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  children,
  icon: Icon,
  confirmLabel,
  confirmIcon,
  cancelLabel = "Cancel",
  tone = "danger",
  loading = false,
  loadingLabel,
  className,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** A question naming the action: "Delete this upload?". */
  title: string;
  /** What happens, in one or two sentences, ending with "This can't be undone." where true. */
  children: ReactNode;
  /** 22px, above the title; rejected for danger (Trash2 for a delete). */
  icon?: LucideIcon;
  /** Named for the result: "Delete upload". */
  confirmLabel: string;
  confirmIcon?: LucideIcon;
  /** The safe choice, named too where it helps: "Keep upload". */
  cancelLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
  loadingLabel?: string;
  className?: string;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const ref = useModalDialog(open, onClose, cancelRef, cancelRef);
  const titleId = useId();
  const bodyId = useId();
  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className={cx("wl-modal", "wl-modal--confirm", className)}
      onKeyDown={trapTab}
    >
      <div className="wl-modal__grab" aria-hidden="true" />
      <div className="wl-modal__confirm">
        {Icon && (
          <Icon
            {...iconProps}
            className={cx("wl-modal__icon", tone === "danger" && "text-rejected")}
          />
        )}
        <h2 id={titleId} className="wl-modal__title">
          {title}
        </h2>
        <div id={bodyId} className="wl-modal__text">
          {children}
        </div>
      </div>
      <div className="wl-modal__actions">
        <Button ref={cancelRef} variant="secondary" onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button
          variant={tone}
          icon={confirmIcon}
          loading={loading}
          loadingLabel={loadingLabel}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
