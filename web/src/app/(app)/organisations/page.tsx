import { Building2 } from "lucide-react";
import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import { PageHeader } from "@/components/templates/PageHeader";
import { StateMessage } from "@/components/ui/StateMessage";
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
        <StateMessage
          kind="empty"
          icon={Building2}
          className="mt-6"
          title="You are not in an organisation yet"
          body={
            <>
              Ask your club admin for an invitation. Running an academy or club?{" "}
              <Link href="/apply" className="text-brand-text underline underline-offset-3">
                Apply to join the pilot
              </Link>
              .
            </>
          }
          action={<SignOutButton />}
        />
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
            <p className="m-0 mt-4 text-body-s text-ink-muted">You belong to one organisation.</p>
          )}
        </>
      )}
    </>
  );
}
