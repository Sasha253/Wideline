import { PageHeader } from "@/components/templates/PageHeader";
import { todayIso } from "@/lib/squad-fields";
import { CLUB_ROLES, requirePageRole } from "@/server/auth/session";
import { AdminOnlyNotice, canEditSquad } from "../../shared";
import { TeamForm } from "../TeamForm";

export const metadata = { title: "Add team" };

/** Add a team (SQUAD01, SQUAD07; docs/build/design/C04.md, Surface 4). Coaches see the admin-only notice. */
export default async function NewTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const ctx = await requirePageRole(CLUB_ROLES);
  const opposition = (await searchParams).kind === "opposition";
  return (
    <>
      <PageHeader
        back={{ href: "/squad/teams", label: "Teams" }}
        title={opposition ? "Add opposition team" : "Add team"}
        intro="Add one team for one season. You can add players to it next."
      />
      {canEditSquad(ctx.roles) ? (
        <section aria-label="Team details" className="wl-card mt-8 max-w-xl">
          <TeamForm
            mode="create"
            defaultKind={opposition ? "opposition" : "own"}
            defaultSeason={todayIso().slice(0, 4)}
          />
        </section>
      ) : (
        <AdminOnlyNotice organisationName={ctx.organisationName} />
      )}
    </>
  );
}
