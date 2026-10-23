import { countryOptions, SA_PROVINCES } from "@/lib/labels";
import { ApplyForm } from "./ApplyForm";

export const metadata = { title: "Join the pilot" };

/** Public: an academy, club or agency asks to join the pilot (ADMIN01). */
export default function ApplyPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <p className="font-display heading-2">Wideline</p>
      <ApplyForm countries={countryOptions()} provinces={SA_PROVINCES} />
    </main>
  );
}
