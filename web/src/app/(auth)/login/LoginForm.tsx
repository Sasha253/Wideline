"use client";

import { Mail, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

type Status =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "error"; message: string }
  | { kind: "link-sent"; email: string };

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>(
    initialError ? { kind: "error", message: "Sign-in failed. Try again." } : { kind: "idle" },
  );
  const busy = status.kind === "busy";

  async function onPassword(e: FormEvent) {
    e.preventDefault();
    setStatus({ kind: "busy" });
    const { error } = await authClient.signIn.email({ email, password });
    if (error) {
      setStatus({ kind: "error", message: "That email and password do not match an account." });
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function onMagicLink() {
    if (!email) {
      setStatus({ kind: "error", message: "Enter your email first." });
      return;
    }
    setStatus({ kind: "busy" });
    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL: next,
      errorCallbackURL: "/login?error=link",
    });
    // Same message whether or not the account exists, so the form does not
    // reveal who has an account.
    if (error && error.status !== 400) {
      setStatus({ kind: "error", message: "Could not send the link. Try again." });
      return;
    }
    setStatus({ kind: "link-sent", email });
  }

  async function onGoogle() {
    setStatus({ kind: "busy" });
    await authClient.signIn.social({ provider: "google", callbackURL: next });
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <form onSubmit={onPassword} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="label">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="wl-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="label">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            className="wl-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="wl-btn wl-btn--primary justify-center" disabled={busy}>
          <LogIn aria-hidden /> Sign in
        </button>
      </form>

      <button
        type="button"
        className="wl-btn wl-btn--secondary justify-center"
        onClick={onMagicLink}
        disabled={busy}
      >
        <Mail aria-hidden /> Email me a sign-in link
      </button>

      {googleEnabled && (
        <button
          type="button"
          className="wl-btn wl-btn--secondary justify-center"
          onClick={onGoogle}
          disabled={busy}
        >
          Continue with Google
        </button>
      )}

      <div aria-live="polite" className="min-h-6">
        {status.kind === "error" && (
          <p role="alert" className="text-danger">
            {status.message}
          </p>
        )}
        {status.kind === "link-sent" && (
          <p>
            If <b>{status.email}</b> has an account, a sign-in link is on its way. It expires in 10
            minutes.
          </p>
        )}
      </div>
    </div>
  );
}
