"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import { Banner } from "@/components/forms";
import { Button, IconButton } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";

/**
 * A native modal dialog for the workspace's own writes (C11, Surfaces 2 and 3; Floodlight,
 * Screens B "Workspace · phone edit"): a modal from 768px and a bottom sheet below, with
 * the grab handle, the title over a mono summary line, a close button, and the actions in
 * a footer (56px primary on phones). The workspace drives it and its submit calls a server
 * action directly, so the result can update the list. It stays a native `dialog`, because
 * the workspace keys switch off while any `dialog[open]` is on the page. Focus starts on
 * the first field; Esc, Close or Cancel closes it and focus returns to the opener.
 */
export function ReviewDialog({
  open,
  title,
  body,
  children,
  formError,
  pending,
  submitLabel,
  pendingLabel,
  submitIcon,
  submitDisabled = false,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  children: ReactNode;
  formError?: string | null;
  pending: boolean;
  submitLabel: string;
  pendingLabel: string;
  submitIcon?: typeof X;
  submitDisabled?: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      requestAnimationFrame(() => {
        dialog.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea")?.focus();
      });
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!pending && !submitDisabled) onSubmit();
  }

  return (
    <dialog
      ref={ref}
      className={cx(
        "m-auto w-full max-w-lg overflow-visible border border-line-strong bg-panel p-0 text-ink shadow-modal",
        "rounded-overlay backdrop:bg-scrim",
        // Phones: a bottom sheet.
        "touch:mx-0 touch:mt-auto touch:mb-0 touch:max-h-[90dvh] touch:max-w-none touch:overflow-y-auto touch:rounded-b-none touch:border-x-0 touch:border-b-0",
      )}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onClose={() => {
        onClose();
        const back = opener.current;
        if (back?.isConnected) back.focus();
      }}
    >
      <div className="grid place-items-center pt-2 pb-1 tablet:hidden" aria-hidden="true">
        <span className="h-1 w-9 rounded-control bg-line-strong" />
      </div>
      <div className="flex items-start gap-3 border-b border-line py-3 pr-2 pl-5 tablet:pt-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 id={titleId} className="m-0 text-title-m">
            {title}
          </h2>
          <div id={bodyId} className="font-mono text-mono-m text-ink-muted">
            {body}
          </div>
        </div>
        <IconButton
          icon={X}
          variant="ghost"
          size="l"
          aria-label="Close"
          onClick={() => ref.current?.close()}
        />
      </div>
      <form noValidate aria-busy={pending || undefined} onSubmit={submit}>
        <div className="flex flex-col gap-4 px-5 py-4">
          {children}
          {formError && <Banner tone="danger">{formError}</Banner>}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-line px-5 pt-3 pb-4 tablet:flex-row tablet:justify-end">
          <Button variant="secondary" block onClick={() => ref.current?.close()}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            block
            icon={submitIcon}
            loading={pending}
            loadingLabel={pendingLabel}
            disabled={submitDisabled}
          >
            {submitLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
