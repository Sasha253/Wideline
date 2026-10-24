import { EmptyState } from "@/components/states/EmptyState";
import { PageHeader } from "@/components/templates/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { teamLabel } from "@/lib/labels";
import { todayIso } from "@/lib/squad-fields";
import { CLUB_ROLES, requirePageRole } from "@/server/auth/session";
import { requireSquadOrgPage } from "@/server/matches/access";
import { HALF_LENGTH_DEFAULT } from "@/server/matches/fields";
import { listTeams } from "@/server/squad/teams";
import { MatchForm } from "../MatchForm";

export const metadata = { title: "Create match" };

/**
 * Create a match (MATCH01; docs/build/design/C06.md, Surface 2). `team`
 * preselects the home team; `away` the opposition just added through the C04
 * team form (Q-024).
 */
export default async function NewMatchPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; away?: string }>;
}) {
  const ctx = requireSquadOrgPage(await requirePageRole(CLUB_ROLES));
  const params = await searchParams;
  const { own, opposition } = await listTeams(ctx);
  const all = [...own, ...opposition];
  const home = own.find((t) => t.id === params.team)?.id ?? (own.length === 1 ? own[0]!.id : "");
  const away = all.find((t) => t.id === params.away)?.id ?? "";

  return (
    <>
      <PageHeader
        back={{ href: "/matches", label: "Matches" }}
        title="Create match"
        intro="You can upload the footage once the match is created."
      />
      {own.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            art={false}
            title="Add a team first"
            body="A match needs your team and the opposition."
            action={
              <ButtonLink variant="primary" href="/squad/teams">
                Go to teams
              </ButtonLink>
            }
          />
        </div>
      ) : (
        <MatchForm
          mode="create"
          own={own.map((t) => ({ id: t.id, label: teamLabel(t) }))}
          opposition={opposition.map((t) => ({ id: t.id, label: teamLabel(t) }))}
          initial={{
            homeTeamId: home,
            awayTeamId: away,
            playedAt: todayIso(),
            venue: "",
            competition: "",
            halfLengthMinutes: String(HALF_LENGTH_DEFAULT),
          }}
        />
      )}
    </>
  );
}
