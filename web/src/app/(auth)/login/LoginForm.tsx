"use client";

import { CircleAlert, Eye, EyeOff, Info, Mail, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { iconProps } from "@/components/ui/icons";
import { authClient } from "@/lib/auth-client";

type Status =
  | { kind: "idle" }
  | { kind: "busy"; action: "password" | "link" | "google" }
  | { kind: "error"; message: string; field?: "email" | "password" }
  | { kind: "link-sent"; email: string };

/** Same message for a wrong email and a wrong password: the form never says which accounts exist. */
const WRONG_DETAILS = "Email or password is wrong. Check both, or sign in with a link instead.";
const RESEND_AFTER_S = 60;

/** The sign-in link expires after 10 minutes (server/auth/auth.ts, magicLink expiresIn). */
const LINK_MINUTES = 10;

function countdown(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Sign in (Floodlight, Screens A "Sign in"): email and password first, then
 * the sign-in link and Google as equal alternatives. The error summary is
 * role=alert and gives one message for a wrong email or password.
 */
export function LoginForm({
  next,
  googleEnabled,
  initialError,
}: {
  next: string;
  googleEnabled: boolean;
  initialError?: string;
}) {
  const router = useRouter();
  const ids = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<Status>(
    initialError
      ? {
          kind: "error",
          message:
            initialError === "link"
              ? "That sign-in link has expired or was already used. Ask for a new one."
              : "Sign-in failed. Try again.",
        }
      : { kind: "idle" },
  );
  const busy = status.kind === "busy";
  const error = status.kind === "error" ? status : null;
  const errorId = `${ids}-error`;

  async function onPassword(e: FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      setStatus({
        kind: "error",
        message: !email ? "Enter your email address." : "Enter your password.",
        field: !email ? "email" : "password",
      });
      return;
    }
    setStatus({ kind: "busy", action: "password" });
    const { error } = await authClient.signIn.email({ email, password });
    if (error) {
      setStatus({ kind: "error", message: WRONG_DETAILS, field: "password" });
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function sendLink(to: string): Promise<boolean> {
    const { error } = await authClient.signIn.magicLink({
      email: to,
      callbackURL: next,
      errorCallbackURL: "/login?error=link",
    });
    // Same outcome whether or not the account exists, so the form does not
    // reveal who has an account.
    return !(error && error.status !== 400);
  }

  async function onMagicLink() {
    if (!email) {
      setStatus({
        kind: "error",
        message: "Enter your email address first, then ask for the link.",
        field: "email",
      });
      return;
    }
    setStatus({ kind: "busy", action: "link" });
    if (!(await sendLink(email))) {
      setStatus({ kind: "error", message: "We couldn't send the link. Try again." });
      return;
    }
    setStatus({ kind: "link-sent", email });
  }

  async function onGoogle() {
    setStatus({ kind: "busy", action: "google" });
    await authClient.signIn.social({ provider: "google", callbackURL: next });
  }

  if (status.kind === "link-sent") {
    return (
      <CheckEmail
        email={status.email}
        onResend={() => sendLink(status.email)}
        onDifferent={() => setStatus({ kind: "idle" })}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 touch:gap-5">
      <div className="flex flex-col gap-3 touch:gap-2.5">
        <h1 className="font-display text-display-l stretch-wide uppercase touch:text-display-phone">
          Sign in
        </h1>
        <p className="text-ink-muted">
          <span className="touch:hidden">Wideline is invite-only during the pilot. </span>
          Use the email address your invitation was sent to.
        </p>
      </div>
      <div aria-live="polite" className="empty:hidden">
        {error && (
          <div
            id={errorId}
            role="alert"
            className="flex gap-2.5 bg-rejected-subtle px-3.5 py-3 font-medium text-rejected"
          >
            <CircleAlert {...iconProps} className="mt-px shrink-0" />
            <span>{error.message}</span>
          </div>
        )}
      </div>
      <form onSubmit={onPassword} className="flex flex-col gap-4" noValidate>
        <div className="wl-field">
          <label htmlFor={`${ids}-email`} className="wl-field__label">
            Email address
          </label>
          <div
            className="wl-control h-control-l touch:h-row"
            data-invalid={error?.field === "email" || undefined}
          >
            <input
              id={`${ids}-email`}
              name="email"
              type="email"
              autoComplete="email"
              required
              className="wl-control__input text-[length:inherit]"
              aria-invalid={error?.field === "email" || undefined}
              aria-describedby={error?.field === "email" ? errorId : undefined}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>
        <div className="wl-field">
          <div className="flex items-baseline justify-between gap-3 touch:contents">
            <label htmlFor={`${ids}-password`} className="wl-field__label">
              Password
            </label>
            {/* No reset flow exists yet: the sign-in link is the way back in. */}
            <button
              type="button"
              className="text-brand-text underline-offset-3 hover:underline touch:order-last touch:flex touch:min-h-control-l touch:items-center touch:self-start"
              onClick={onMagicLink}
              disabled={busy}
            >
              Forgot password?
            </button>
          </div>
          <div
            className="wl-control h-control-l pr-1 touch:h-row touch:pr-0.5"
            data-invalid={error?.field === "password" || undefined}
          >
            <input
              id={`${ids}-password`}
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              className={cx(
                "wl-control__input text-[length:inherit]",
                !showPassword && password && "font-mono tracking-[0.12em]",
              )}
              aria-invalid={error?.field === "password" || undefined}
              aria-describedby={error?.field === "password" ? errorId : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="grid size-9 shrink-0 place-items-center rounded-control text-ink-muted hover:bg-raised hover:text-ink touch:size-11"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff {...iconProps} /> : <Eye {...iconProps} />}
              {/* Text, not aria-label, so the field stays the only thing labelled "Password". */}
              <span className="sr-only">Show password</span>
            </button>
          </div>
        </div>
        <Button
          type="submit"
          variant="primary"
          size="l"
          block
          className="justify-center touch:order-last touch:h-control-xl"
          loading={status.kind === "busy" && status.action === "password"}
          loadingLabel="Signing in"
          disabled={busy}
        >
          Sign in
        </Button>
      </form>

      <div
        className="flex items-center gap-3 font-mono text-overline text-ink-muted touch:hidden"
        aria-hidden
      >
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="secondary"
          size="l"
          block
          icon={Mail}
          className="justify-center touch:h-row"
          onClick={onMagicLink}
          loading={status.kind === "busy" && status.action === "link"}
          loadingLabel="Sending"
          disabled={busy}
        >
          Email me a sign-in link
        </Button>
        {googleEnabled && (
          <Button
            type="button"
            variant="secondary"
            size="l"
            block
            className="justify-center touch:h-row"
            onClick={onGoogle}
            loading={status.kind === "busy" && status.action === "google"}
            loadingLabel="Opening Google"
            disabled={busy}
          >
            <span
              aria-hidden
              className="grid size-4.5 place-items-center rounded-full border-2 border-current text-overline leading-none font-bold"
            >
              G
            </span>
            Continue with Google
          </Button>
        )}
      </div>

      <p className="text-body-s text-ink-muted">
        Scouts can{" "}
        <Link href="/register" className="text-brand-text underline underline-offset-3">
          apply for access
        </Link>
        . By signing in you agree to the terms and privacy notice.
      </p>
    </div>
  );
}

/** "Check your email": the link works once; resend after a minute. */
function CheckEmail({
  email,
  onResend,
  onDifferent,
}: {
  email: string;
  onResend: () => Promise<boolean>;
  onDifferent: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [left, setLeft] = useState(RESEND_AFTER_S);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (left <= 0) return;
    const t = window.setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left]);

  async function resend() {
    if (left > 0 || sending) return;
    setSending(true);
    const ok = await onResend();
    setSending(false);
    setNote(
      ok ? "We sent a new link. Use the newest one." : "We couldn't send the link. Try again.",
    );
    if (ok) setLeft(RESEND_AFTER_S);
  }

  return (
    <div className="flex flex-col gap-5">
      <span className="grid size-16 place-items-center bg-selected" aria-hidden>
        <Mail {...iconProps} size={30} />
      </span>
      <h1 ref={headingRef} tabIndex={-1} className="text-title-guardian stretch-semi outline-none">
        Check your email
      </h1>
      <p className="text-body-guardian">
        We sent a sign-in link to <span className="font-semibold">{email}</span>. It works once and
        expires in {LINK_MINUTES} minutes.
      </p>
      <ul className="border-t border-line text-ink-muted" role="list">
        <li className="flex gap-3 border-b border-line py-3.5">
          <Info {...iconProps} className="mt-px shrink-0 text-ink" />
          <span>Not there after a few minutes? Check your spam folder.</span>
        </li>
        <li className="flex gap-3 border-b border-line py-3.5">
          <Users {...iconProps} className="mt-px shrink-0 text-ink" />
          <span>Still nothing? Ask your club admin to check the address they invited.</span>
        </li>
      </ul>
      <div aria-live="polite" className="empty:hidden">
        {note && <p className="text-body-s text-ink-muted">{note}</p>}
      </div>
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="primary"
          size="l"
          block
          className="justify-center touch:h-control-xl"
          disabled={left > 0}
          loading={sending}
          loadingLabel="Sending"
          onClick={() => void resend()}
        >
          {left > 0 ? (
            <>
              Resend link in <span className="font-mono tabular-nums">{countdown(left)}</span>
            </>
          ) : (
            "Resend link"
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="l"
          block
          className="justify-center"
          onClick={onDifferent}
        >
          Use a different email
        </Button>
      </div>
    </div>
  );
}
