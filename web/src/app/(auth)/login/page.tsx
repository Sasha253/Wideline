import { redirect } from "next/navigation";
import { googleSignInEnabled } from "@/server/auth/auth";
import { getAuthContext } from "@/server/auth/session";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  // Only same-site paths, so the login page cannot be used as an open redirect.
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : "/lab/matches";

  if (await getAuthContext()) redirect(safeNext);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-12">
      <p className="font-display text-[28px] font-semibold leading-none">Wideline</p>
      <h1 className="heading-2 mt-6">Sign in</h1>
      <p className="mt-1 text-ink-muted">Wideline is invite-only during the pilot.</p>
      <LoginForm next={safeNext} googleEnabled={googleSignInEnabled()} initialError={error} />
    </main>
  );
}
