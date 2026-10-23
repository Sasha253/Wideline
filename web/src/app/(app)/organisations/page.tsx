import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import { PageHeader } from "@/components/templates/PageHeader";
import { locationText, ORG_TYPE_LABELS, ROLE_LABELS } from "@/lib/labels";
import { requireUser } from "@/server/auth/session";
import { OrganisationList } from "./OrganisationList";

export const metadata = { title: "Your organisations" };

/** Every organisation the user belongs to, with a switch per organisation (AUTH05). */
export default async function OrganisationsPage() {
  const ctx = await requireUser();

  return (
    <>
      <PageHeader
        title="Your organisations"
        intro="Choose which organisation you are working in. Wideline shows that organisation's squads, matches and settings."
      />

      {ctx.organisations.length === 0 ? (
        <div className="mt-6">
          <p className="body-lg text-ink-muted">
            You are not in an organisation yet. Ask your club admin for an invitation.
          </p>
          <p className="body mt-4">
            Running an academy or club?{" "}
            <Link href="/apply" className="text-pitch underline">
              Apply to join the pilot
            </Link>
            .
          </p>
          <SignOutButton className="mt-6" />
        </div>
      ) : (
        <>
          <OrganisationList
            currentId={ctx.organisationId}
            organisations={ctx.organisations.map((o) => ({
              id: o.id,
              name: o.name,
              meta: `${ORG_TYPE_LABELS[o.type]} · ${locationText(o.country, o.region)}`,
              roles: o.roles.map((r) => ROLE_LABELS[r]).join(", "),
            }))}
          />
          {ctx.organisations.length === 1 && (
            <p className="caption mt-4 text-ink-muted">You belong to one organisation.</p>
          )}
        </>
      )}
    </>
  );
}
