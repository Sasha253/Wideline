import { AppShell } from "@/components/shell/AppShell";
import { requireUser } from "@/server/auth/session";

/**
 * The authenticated layout: the app shell around every signed-in page
 * (docs/build/design/D02.md). The shell is a convenience; each page calls
 * requirePageRole() itself (AUTH06).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireUser();
  return <AppShell ctx={ctx}>{children}</AppShell>;
}
