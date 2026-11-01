import { ReviewThemeScope } from "@/components/ui/theme-server";
import { LAB_ROLES, requirePageRole } from "@/server/auth/session";
import { LabNav } from "./LabNav";

// The CV Lab content area stays dark inside the shell, as the review workspace does: video
// reads better on it. It follows Light only when the user chose Light (Floodlight rule 6;
// docs/design-handoff/IMPLEMENTATION.md, section 5).
// C09 adds the Matches and Benchmark sub-navigation (docs/build/design/C09.md, Surface 1).
export default async function LabLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole(LAB_ROLES);
  return (
    <ReviewThemeScope className="border border-line bg-canvas p-4 text-ink tablet:p-6">
      <LabNav />
      <div className="mt-6">{children}</div>
    </ReviewThemeScope>
  );
}
