import { redirect } from "next/navigation";
import { countryOptions } from "@/lib/labels";
import { getUserContext } from "@/server/auth/session";
import { getOwnScoutProfile } from "@/server/scouts/profile";
import { RegisterForm } from "./RegisterForm";
import { TermsText } from "./TermsText";

export const metadata = { title: "Apply to scout" };

/**
 * Public: an independent scout asks to review matches (AUTH08, AUTH09, AUTH10;
 * Floodlight, "Scout registration"). A signed-in user registers their own account and
 * skips the email and password; one who already has a scout profile goes to /scout. No
 * app shell: the form draws its own step sidebar (desktop) or step bar (phones).
 */
export default async function RegisterPage() {
  const ctx = await getUserContext();
  if (ctx && (await getOwnScoutProfile(ctx.user.id))) redirect("/scout");

  return (
    <main id="main" className="min-h-dvh bg-canvas text-ink">
      <RegisterForm
        signedIn={ctx ? { name: ctx.user.name, email: ctx.user.email } : null}
        countries={countryOptions()}
        terms={<TermsText />}
      />
    </main>
  );
}
