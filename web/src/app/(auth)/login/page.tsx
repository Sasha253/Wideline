import { redirect } from "next/navigation";
import { googleSignInEnabled } from "@/server/auth/auth";
import { safeNextPath } from "@/lib/safe-next";
import { getUserContext } from "@/server/auth/session";
import { LoginForm } from "./LoginForm";
import { Logo } from "@/components/ui/Logo";

export const metadata = { title: "Sign in" };

/**
 * The pitch-line panel of the desktop sign-in (Screens A, "Sign in · desktop"):
 * the only illustration, with the near touchline drawn in lime. Always dark.
 */
function PitchPanel() {
  return (
    <div
      data-theme="dark"
      className="relative hidden flex-col justify-between overflow-hidden bg-sunken px-12 pt-10 pb-12 text-ink desktop:flex"
    >
      <svg
        viewBox="0 0 640 800"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 size-full"
        fill="none"
        stroke="var(--wl-color-line-strong)"
        strokeWidth="1.5"
        aria-hidden
      >
        <rect x="72" y="-20" width="496" height="840" />
        <line x1="72" y1="430" x2="568" y2="430" />
        <circle cx="320" cy="430" r="92" />
        <circle cx="320" cy="430" r="3" fill="var(--wl-color-line-strong)" />
        <rect x="196" y="-20" width="248" height="150" />
        <rect x="266" y="-20" width="108" height="60" />
        <circle cx="320" cy="90" r="3" fill="var(--wl-color-line-strong)" />
        <path d="M237 130 A92 92 0 0 0 403 130" />
        <rect x="565" y="-20" width="7" height="840" fill="var(--wl-color-brand)" stroke="none" />
      </svg>
      <div className="relative">
        <Logo />
      </div>
      <div className="relative flex max-w-105 flex-col gap-4">
        <p className="text-title-guardian stretch-semi text-balance">
          Every number on Wideline comes from a clip a scout has checked.
        </p>
        <p className="font-mono text-overline text-ink-muted uppercase">
          Pilot · South Africa · 2026
        </p>
      </div>
    </div>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  // Only same-site paths, so the login page cannot be used as an open redirect.
  const safeNext = safeNextPath(next, "/");

  const ctx = await getUserContext();
  // Without an organisation, only an invitation or scout registration can continue.
  if (ctx) {
    const canContinue =
      ctx.organisationId ||
      safeNext.startsWith("/invite/") ||
      /^\/register(?:[/?]|$)/.test(safeNext);
    redirect(canContinue ? safeNext : "/organisations");
  }

  return (
    <div className="grid min-h-screen bg-canvas text-ink desktop:grid-cols-2">
      <PitchPanel />
      <main className="flex flex-col px-5 pt-4 pb-6 tablet:items-center tablet:justify-center tablet:px-12 tablet:py-12 wide:px-24">
        <div className="flex w-full max-w-100 flex-col gap-6 touch:gap-5">
          <div className="desktop:hidden">
            <Logo size="m" />
          </div>
          <LoginForm next={safeNext} googleEnabled={googleSignInEnabled()} initialError={error} />
        </div>
      </main>
    </div>
  );
}
