"use client";

import { useCallback, useLayoutEffect, useRef, type ComponentProps, type Ref } from "react";

type ButtonElementProps = ComponentProps<"button"> & {
  /** Busy: shows the spinner (rendered by the caller), keeps the width and blocks activation. */
  loading?: boolean;
};

function assignRef<T>(ref: Ref<T> | undefined, node: T | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

/**
 * The <button> behind Button and IconButton (Floodlight, docs/design-handoff/README.md,
 * "Button"). Disabled uses aria-disabled, so the button stays focusable and a screen
 * reader can still reach it and the reason beside it; clicks (and Enter submitting the
 * form) are swallowed while it is disabled or loading. While loading, the button keeps
 * the width it had before, so the row does not jump when the label becomes "Saving".
 */
export function ButtonElement({
  disabled,
  loading = false,
  onClick,
  ref,
  ...rest
}: ButtonElementProps) {
  const node = useRef<HTMLButtonElement | null>(null);
  const idleWidth = useRef(0);

  const setRef = useCallback(
    (el: HTMLButtonElement | null) => {
      node.current = el;
      assignRef(ref, el);
    },
    [ref],
  );

  useLayoutEffect(() => {
    const el = node.current;
    if (!el) return;
    if (loading) {
      if (idleWidth.current) el.style.minWidth = `${idleWidth.current}px`;
    } else {
      el.style.minWidth = "";
      idleWidth.current = el.offsetWidth;
    }
  });

  const blocked = Boolean(disabled) || loading;
  return (
    <button
      ref={setRef}
      aria-disabled={disabled ? true : undefined}
      aria-busy={loading ? true : undefined}
      onClick={(e) => {
        if (blocked) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onClick?.(e);
      }}
      {...rest}
    />
  );
}
