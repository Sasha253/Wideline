import { redirect } from "next/navigation";
import { googleSignInEnabled } from "@/server/auth/auth";
import { safeNextPath } from "@/lib/safe-next";
import { getUserContext } from "@/server/auth/session";
import { LoginForm } from "./LoginForm";
import { Logo } from "@/components/ui/Logo";

export const metadata = { title: "Sign in" };

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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-12">
      <p className="text-[28px]">
        <Logo />
      </p>
      <h1 className="heading-2 mt-6">Sign in</h1>
      <p className="mt-1 text-ink-muted">Wideline is invite-only during the pilot.</p>
      <LoginForm next={safeNext} googleEnabled={googleSignInEnabled()} initialError={error} />
    </main>
  );
}
