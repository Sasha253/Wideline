import { notFound } from "next/navigation";
import { cache } from "react";
import { Banner } from "@/components/forms";
import { PageHeader } from "@/components/templates/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { teamLabel } from "@/lib/labels";
import { CLUB_ROLES, requirePageRole, type AuthContext } from "@/server/auth/session";
import { requireSquadOrgPage } from "@/server/squad/access";
import { getTeam, inUseMessage, TeamError, teamUsage, type TeamDetail } from "@/server/squad/teams";
import { canEditSquad, Facts } from "../../shared";
import { TeamForm } from "../TeamForm";
import { DeleteTeam } from "./DeleteTeam";
import { PlaceholderForm } from "./PlaceholderForm";

type Props = {
  params: Promise<{ teamId: string }>;
  searchParams?: Promise<{ done?: string }>;
};

// One read per request, shared by generateMetadata and the page.
const loadTeam = cache(async (ctx: AuthContext, teamId: string): Promise<TeamDetail | null> => {
  try {
    return await getTeam(ctx, teamId);
  } catch (err) {
    if (err instanceof TeamError && err.code === "not_found") return null;
    throw err;
  }
});

export async function generateMetadata({ params }: Props) {
  const ctx = requireSquadOrgPage(await requirePageRole(CLUB_ROLES));
  const team = await loadTeam(ctx, (await params).teamId);
  return { title: team ? teamLabel(team) : "Team" };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * One team (SQUAD01, SQUAD07; docs/build/design/C04.md, Surface 4): details,
 * its players or placeholder shirt numbers, and delete while unused. Another
 * organisation's team is not found.
 */
export default async function TeamPage({ params, searchParams }: Props) {
  const ctx = requireSquadOrgPage(await requirePageRole(CLUB_ROLES));
  const team = await loadTeam(ctx, (await params).teamId);
  if (!team) notFound();
  const done = (await searchParams)?.done;
  const admin = canEditSquad(ctx.roles);
  const label = teamLabel(team);
  const usage = teamUsage(team);
  const inUse = usage.players + usage.matches + usage.lineups > 0;

  const intro = team.isOpposition
    ? undefined
    : `${plural(team.activeCount, "current player", "current players")}${
        team.departedCount ? ` · ${team.departedCount} departed` : ""
      }`;

  return (
    <>
      <PageHeader
        back={{ href: "/squad/teams", label: "Teams" }}
        eyebrow={team.isOpposition ? "Opposition team" : "Team"}
        title={label}
        intro={intro}
      />
      <div aria-live="polite" className="mt-6 empty:mt-0">
        {done === "created" && (
          <Banner tone="ok">
            {label} added.{" "}
            {team.isOpposition ? "Add their shirt numbers below." : "Add players next."}
          </Banner>
        )}
      </div>

      <section aria-labelledby="team-details" className="mt-8">
        <h2
          id="team-details"
          tabIndex={-1}
          className="font-display text-heading-section uppercase stretch-wide"
        >
          Details
        </h2>
        <div className="wl-card mt-4 max-w-xl">
          {admin ? (
            <TeamForm
              mode="edit"
              teamId={team.id}
              isOpposition={team.isOpposition}
              initial={{
                name: team.name,
                ageGroup: team.ageGroup,
                gender: team.gender,
                season: team.season,
              }}
            />
          ) : (
            <Facts
              items={[
                ["Team name", team.name],
                ["Age group", team.ageGroup],
                ["Gender", team.gender],
                ["Season", team.season],
              ]}
            />
          )}
        </div>
      </section>

      {team.isOpposition ? (
        <section aria-labelledby="team-placeholders" className="mt-8">
          <h2
            id="team-placeholders"
            tabIndex={-1}
            className="font-display text-heading-section uppercase stretch-wide"
          >
            Placeholder players
          </h2>
          <p className="mt-2 max-w-prose text-ink-muted">
            Shirt numbers for this team&apos;s players. Events in their matches are recorded against
            these numbers, never against names.
          </p>
          {team.numbers.length > 0 ? (
            <>
              <p className="text-body-s mt-4 text-ink-muted">
                {plural(team.numbers.length, "placeholder player", "placeholder players")}
              </p>
              <p className="font-mono text-mono-m tabular-nums mt-1 break-words">
                {team.numbers.join(", ")}
              </p>
            </>
          ) : (
            <p className="mt-4 text-ink-muted">No placeholder players yet.</p>
          )}
          {admin && <PlaceholderForm teamId={team.id} />}
        </section>
      ) : (
        <section aria-labelledby="team-players" className="mt-8">
          <h2
            id="team-players"
            tabIndex={-1}
            className="font-display text-heading-section uppercase stretch-wide"
          >
            Players
          </h2>
          <p className="mt-2">
            {team.activeCount === 0
              ? "No players yet."
              : `${plural(team.activeCount, "current player", "current players")}.`}
          </p>
          <div className="wl-row mt-4">
            <ButtonLink variant="secondary" size="s" href={`/squad?team=${team.id}`}>
              View in squad
            </ButtonLink>
            {admin && (
              <>
                <ButtonLink
                  variant="secondary"
                  size="s"
                  href={`/squad/players/new?team=${team.id}`}
                >
                  Add player
                </ButtonLink>
                <ButtonLink variant="secondary" size="s" href={`/squad/import?team=${team.id}`}>
                  Import from CSV
                </ButtonLink>
              </>
            )}
          </div>
        </section>
      )}

      {admin && (
        <section aria-labelledby="team-delete" className="mt-8">
          <h2
            id="team-delete"
            tabIndex={-1}
            className="font-display text-heading-section uppercase stretch-wide"
          >
            Delete team
          </h2>
          {inUse ? (
            <p className="mt-2 max-w-prose text-ink-muted">
              {inUseMessage(usage, team.isOpposition)}
            </p>
          ) : (
            <>
              <p className="mt-2 text-ink-muted">
                This team has no players, matches or lineups, so you can delete it.
              </p>
              <div className="mt-4">
                <DeleteTeam teamId={team.id} label={label} />
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
