import { countryOptions, SA_PROVINCES } from "@/lib/labels";
import { Logo } from "@/components/ui/Logo";
import { ApplyForm } from "./ApplyForm";

export const metadata = { title: "Join the pilot" };

/** Public: an academy, club or agency asks to join the pilot (ADMIN01). No app shell. */
export default function ApplyPage() {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-120 flex-col bg-canvas px-5 py-10 text-ink tablet:py-14"
    >
      <Logo />
      <ApplyForm countries={countryOptions()} provinces={SA_PROVINCES} />
    </main>
  );
}
