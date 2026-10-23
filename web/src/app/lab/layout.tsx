import { ListVideo } from "lucide-react";
import Link from "next/link";
import { SignOutButton } from "@/components/lab/SignOutButton";
import { ThemeScope } from "@/components/ui/theme";
import { LAB_ROLES, requirePageRole } from "@/server/auth/session";

// The CV Lab uses the dark theme: video reads better on it.
export default async function LabLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageRole(LAB_ROLES);

  return (
    <ThemeScope theme="dark" className="min-h-screen lg:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 wl-btn wl-btn--secondary"
      >
        Skip to content
      </a>
      <aside className="flex items-center justify-between gap-4 border-b border-line bg-surface-sunken px-4 py-3 lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:flex-col lg:items-stretch lg:justify-start lg:border-b-0 lg:border-r lg:py-6">
        <div>
          <p className="font-display text-[24px] font-semibold leading-none">Wideline</p>
          <p className="eyebrow mt-1 text-ink-muted">CV Lab</p>
        </div>
        <nav aria-label="Lab" className="flex gap-1 lg:mt-8 lg:flex-col">
          <Link href="/lab/matches" className="wl-btn wl-btn--ghost wl-btn--sm lg:justify-start">
            <ListVideo aria-hidden /> Matches
          </Link>
        </nav>
        <div className="hidden lg:mt-auto lg:block">
          <p className="body-strong truncate">{ctx.user.name}</p>
          <p className="caption truncate text-ink-muted">{ctx.organisationName}</p>
          <div className="mt-2">
            <SignOutButton />
          </div>
        </div>
        <div className="lg:hidden">
          <SignOutButton />
        </div>
      </aside>
      <main id="main" className="min-w-0 flex-1 px-4 py-6 md:px-6 lg:px-8">
        {children}
      </main>
    </ThemeScope>
  );
}
