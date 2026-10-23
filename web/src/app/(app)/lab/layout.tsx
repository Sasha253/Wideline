import { ThemeScope } from "@/components/ui/theme";
import { LAB_ROLES, requirePageRole } from "@/server/auth/session";

// The CV Lab content area is forced dark inside the shell: video reads better on it.
// The shell around it follows the system setting (docs/build/design/D02.md, Surface 7).
export default async function LabLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole(LAB_ROLES);
  return (
    <ThemeScope theme="dark" className="rounded-lg p-4 md:p-6">
      {children}
    </ThemeScope>
  );
}
