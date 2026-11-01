"use client";

import { Check, Clock, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cx } from "./cx";
import { iconProps } from "./icons";

/*
 * Toasts (Floodlight, "Toast"): a short note that something happened in the background.
 * Saves, background progress and recoverable failures, with at most one action (Undo,
 * Try again). Not for anything the user must act on to continue: that is a banner or a
 * dialog. No celebration: "Correction saved" is enough.
 *
 * Bottom left on desktop, away from the event list; above the bottom tab bar on phones.
 * They stay 6 s and pause while hovered or focused. Errors stay until dismissed.
 * role="status" (polite), or role="alert" for errors.
 *
 * Mount <ToastProvider> once (the app shell), then:
 *   const toast = useToast();
 *   toast.success("Correction saved", { description: "Goal moved from 31:24 to 31:26",
 *     action: { label: "Undo", icon: <Undo2 {...iconProps} />, onClick: undo } });
 */

export type ToastTone = "success" | "info" | "warning" | "error";

export type ToastAction = {
  label: string;
  onClick: () => void;
  /** An icon element, e.g. <Undo2 {...iconProps} />. */
  icon?: ReactNode;
};

export type ToastOptions = {
  description?: ReactNode;
  action?: ToastAction;
  /** ms before it goes. Default 6000; errors default to null (stay until dismissed). */
  duration?: number | null;
  /** Reuse an id to replace a toast in place ("Upload paused at 62%" → resumed). */
  id?: string;
};

export type ToastInput = ToastOptions & { tone?: ToastTone; title: string };

export type ToastApi = {
  show: (toast: ToastInput) => string;
  success: (title: string, options?: ToastOptions) => string;
  info: (title: string, options?: ToastOptions) => string;
  warning: (title: string, options?: ToastOptions) => string;
  error: (title: string, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
};

export const TOAST_DURATION = 6000;
/** At most this many toasts show at once; the oldest goes first. */
const MAX_TOASTS = 3;

const TONE_ICON: Record<ToastTone, LucideIcon> = {
  success: Check,
  info: Info,
  warning: Clock,
  error: TriangleAlert,
};

/** One toast, as drawn. Use useToast() to show one; this is exported for galleries. */
export function Toast({
  tone = "info",
  title,
  description,
  action,
  onDismiss,
  className,
}: {
  tone?: ToastTone;
  title: string;
  description?: ReactNode;
  action?: ToastAction;
  onDismiss?: () => void;
  className?: string;
}) {
  const Icon = TONE_ICON[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx("wl-toast", `wl-toast--${tone}`, className)}
    >
      <Icon {...iconProps} className="wl-toast__icon" />
      <div className="wl-toast__text">
        <p className="wl-toast__title">{title}</p>
        {description && <p className="wl-toast__sub">{description}</p>}
      </div>
      {action && (
        <button type="button" className="wl-toast__action" onClick={action.onClick}>
          {action.icon}
          {action.label}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          className="wl-toast__dismiss"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={onDismiss}
        >
          <X {...iconProps} />
        </button>
      )}
    </div>
  );
}

type ToastRecord = ToastInput & { id: string; tone: ToastTone; duration: number | null };

function TimedToast({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(toast.duration ?? 0);
  const paused = hovered || focused;
  const { id, duration } = toast;

  useEffect(() => {
    if (duration === null || paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => onDismiss(id), Math.max(0, remaining.current));
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [duration, paused, id, onDismiss]);

  return (
    <div
      className="wl-toasts__item"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <Toast
        tone={toast.tone}
        title={toast.title}
        description={toast.description}
        action={
          toast.action && {
            ...toast.action,
            onClick: () => {
              toast.action!.onClick();
              onDismiss(id);
            },
          }
        }
        onDismiss={() => onDismiss(id)}
      />
    </div>
  );
}

const ToastContext = createContext<ToastApi | null>(null);

let sequence = 0;

/** Holds the toasts and draws the region. Mount once, high in the tree (the app shell). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((input: ToastInput) => {
    const tone = input.tone ?? "info";
    const id = input.id ?? `toast-${++sequence}`;
    const duration =
      input.duration !== undefined ? input.duration : tone === "error" ? null : TOAST_DURATION;
    setToasts((all) => {
      const at = all.findIndex((t) => t.id === id);
      const record: ToastRecord = { ...input, id, tone, duration };
      if (at >= 0) return all.map((t, i) => (i === at ? record : t));
      return [...all, record].slice(-MAX_TOASTS);
    });
    return id;
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (title, o) => show({ ...o, title, tone: "success" }),
      info: (title, o) => show({ ...o, title, tone: "info" }),
      warning: (title, o) => show({ ...o, title, tone: "warning" }),
      error: (title, o) => show({ ...o, title, tone: "error" }),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext value={api}>
      {children}
      <div className="wl-toasts" aria-label="Notifications" role="region">
        {toasts.map((t) => (
          <TimedToast key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext>
  );
}

const NO_TOASTS: ToastApi = {
  show: () => "",
  success: () => "",
  info: () => "",
  warning: () => "",
  error: () => "",
  dismiss: () => {},
};

/** Shows toasts. Without a ToastProvider above it, calls do nothing. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NO_TOASTS;
}
