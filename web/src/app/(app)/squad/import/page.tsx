import { EmptyState } from "@/components/states/EmptyState";
import { PageHeader } from "@/components/templates/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { teamLabel } from "@/lib/labels";
import { CLUB_ROLES, requirePageRole } from "@/server/auth/session";
import { listTeams } from "@/server/squad/teams";
import { AdminOnlyNotice, canEditSquad } from "../shared";
import { ImportFlow } from "./ImportFlow";

export const metadata = { title: "Import players" };

/**
 * The CSV import (SQUAD03; docs/build/design/C04.md, Surface 6): choose a file,
 * check the preview, confirm. Nothing is saved until the confirm. Coaches see
 * the admin-only notice.
 */
export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  const ctx = await requirePageRole(CLUB_ROLES);
  const { own } = await listTeams(ctx);
  const wanted = (await searchParams).team;
  const team = own.find((t) => t.id === wanted) ?? own[0] ?? null;

  return (
    <>
      <PageHeader
        back={{ href: team ? `/squad?team=${team.id}` : "/squad", label: "Squad" }}
        title="Import players"
        intro="Add a whole squad from a spreadsheet. Nothing is saved until you check the preview and confirm."
      />
      {!canEditSquad(ctx.roles) ? (
        <AdminOnlyNotice organisationName={ctx.organisationName} />
      ) : own.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            art={false}
            title="Add a team first"
            body="Players are imported into a team. Add your first team, then come back."
            action={
              <ButtonLink variant="primary" href="/squad/teams/new">
                Add team
              </ButtonLink>
            }
          />
        </div>
      ) : (
        <ImportFlow
          teams={own.map((t) => ({ id: t.id, label: teamLabel(t) }))}
          defaultTeamId={team?.id ?? own[0]!.id}
        />
      )}
    </>
  );
}
