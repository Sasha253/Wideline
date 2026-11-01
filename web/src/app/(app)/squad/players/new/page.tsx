import Link from "next/link";
import { EmptyState } from "@/components/states/EmptyState";
import { PageHeader } from "@/components/templates/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { teamLabel } from "@/lib/labels";
import { todayIso } from "@/lib/squad-fields";
import { CLUB_ROLES, requirePageRole } from "@/server/auth/session";
import { requireSquadOrgPage } from "@/server/squad/access";
import { listTeams } from "@/server/squad/teams";
import { AdminOnlyNotice, canEditSquad } from "../../shared";
import { EMPTY_PLAYER } from "../form-values";
import { PlayerForm } from "../PlayerForm";

export const metadata = { title: "Add player" };

/**
 * Add one player (SQUAD02; docs/build/design/C04.md, Surface 5). `?team=`
 * preselects an own team. Coaches see the admin-only notice.
 */
export default async function NewPlayerPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  const ctx = requireSquadOrgPage(await requirePageRole(CLUB_ROLES));
  const { own } = await listTeams(ctx);
  const wanted = (await searchParams).team;
  const team = own.find((t) => t.id === wanted) ?? own[0] ?? null;
  const teamQuery = team && own.length > 0 ? `?team=${team.id}` : "";

  return (
    <>
      <PageHeader
        back={{ href: `/squad${teamQuery}`, label: "Squad" }}
        title="Add player"
        intro={
          <>
            Add one player to a team. To add a whole squad,{" "}
            <Link href={`/squad/import${teamQuery}`} className="text-brand-text underline">
              import a CSV file
            </Link>{" "}
            instead.
          </>
        }
      />
      {!canEditSquad(ctx.roles) ? (
        <AdminOnlyNotice organisationName={ctx.organisationName} />
      ) : own.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            art={false}
            title="Add a team first"
            body="Every player belongs to a team for a season. Add your first team, then come back."
            action={
              <ButtonLink variant="primary" href="/squad/teams/new">
                Add team
              </ButtonLink>
            }
          />
        </div>
      ) : (
        <PlayerForm
          mode="create"
          initial={{ ...EMPTY_PLAYER, teamId: team?.id ?? "" }}
          teams={own.map((t) => ({ id: t.id, label: teamLabel(t) }))}
          today={todayIso()}
        />
      )}
    </>
  );
}
