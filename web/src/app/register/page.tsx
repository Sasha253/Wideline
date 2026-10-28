import { redirect } from "next/navigation";
import { countryOptions } from "@/lib/labels";
import { getUserContext } from "@/server/auth/session";
import { getOwnScoutProfile } from "@/server/scouts/profile";
import { RegisterForm } from "./RegisterForm";
import { TermsText } from "./TermsText";
import { Logo } from "@/components/ui/Logo";

export const metadata = { title: "Register as a scout" };

/**
 * Public: an independent scout asks to review matches (AUTH08, AUTH09, AUTH10;
 * docs/build/design/C02.md, Surface 1). A signed-in user registers their own
 * account and skips the email and password; one who already has a scout
 * profile goes to /scout.
 */
export default async function RegisterPage() {
  const ctx = await getUserContext();
  if (ctx && (await getOwnScoutProfile(ctx.user.id))) redirect("/scout");

  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-8 md:px-6 md:py-12">
      <p className="heading-2">
        <Logo />
      </p>
      <RegisterForm
        signedIn={ctx ? { name: ctx.user.name, email: ctx.user.email } : null}
        countries={countryOptions()}
        terms={<TermsText />}
      />
    </main>
  );
}
