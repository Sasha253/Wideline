import { notFound } from "next/navigation";
import { PageHeader } from "@/components/templates/PageHeader";
import { teamLabel } from "@/lib/labels";
import { todayIso } from "@/lib/squad-fields";
import { CLUB_ROLES, requirePageRole } from "@/server/auth/session";
import { requireSquadOrgPage } from "@/server/matches/access";
import { listTeams } from "@/server/squad/teams";
import { MatchForm } from "../../MatchForm";
import { loadMatch } from "../load";

export const metadata = { title: "Edit match" };

/**
 * Edit a match (MATCH01; docs/build/design/C06.md, Surface 2). Allowed at every
 * status; team and half-length changes follow the server rules.
 */
export default async function EditMatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  const ctx = requireSquadOrgPage(await requirePageRole(CLUB_ROLES));
  const match = await loadMatch(ctx, (await params).matchId);
  if (!match) notFound();
  const { own, opposition } = await listTeams(ctx);
  return (
    <>
      <PageHeader back={{ href: `/matches/${match.id}`, label: "Match" }} title="Edit match" />
      <MatchForm
        mode="edit"
        matchId={match.id}
        own={own.map((t) => ({ id: t.id, label: teamLabel(t) }))}
        opposition={opposition.map((t) => ({ id: t.id, label: teamLabel(t) }))}
        initial={{
          homeTeamId: match.homeTeam.id,
          awayTeamId: match.awayTeam.id,
          playedAt: todayIso(match.playedAt),
          venue: match.venue ?? "",
          competition: match.competition ?? "",
          halfLengthMinutes: String(match.halfLengthMinutes),
        }}
      />
    </>
  );
}
