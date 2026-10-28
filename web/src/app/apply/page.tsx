import { countryOptions, SA_PROVINCES } from "@/lib/labels";
import { ApplyForm } from "./ApplyForm";
import { Logo } from "@/components/ui/Logo";

export const metadata = { title: "Join the pilot" };

/** Public: an academy, club or agency asks to join the pilot (ADMIN01). */
export default function ApplyPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <p className="heading-2">
        <Logo />
      </p>
      <ApplyForm countries={countryOptions()} provinces={SA_PROVINCES} />
    </main>
  );
}
