import { PageHeader } from "@/components/templates/PageHeader";
import { countryOptions, SA_PROVINCES } from "@/lib/labels";
import { ORG_ADMIN_ROLES, requirePageRole } from "@/server/auth/session";
import { SettingsNav } from "../SettingsNav";
import { SettingsForm } from "./SettingsForm";

export const metadata = { title: "Organisation settings" };

export default async function OrganisationSettingsPage() {
  const ctx = await requirePageRole(ORG_ADMIN_ROLES);
  const org = await ctx.db.organisation.findUniqueOrThrow({
    where: { id: ctx.organisationId },
    select: { name: true, type: true, country: true, region: true },
  });

  return (
    <>
      <PageHeader
        title="Organisation settings"
        intro={`How ${org.name} appears to scouts and on player profiles.`}
      />
      <SettingsNav current="organisation" />
      <section aria-label="Organisation details" className="wl-card mt-8 max-w-xl">
        <SettingsForm initial={org} countries={countryOptions()} provinces={SA_PROVINCES} />
      </section>
    </>
  );
}
