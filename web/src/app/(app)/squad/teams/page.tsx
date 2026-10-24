import { Plus } from "lucide-react";
import Link from "next/link";
import { Banner } from "@/components/forms";
import { DataTable } from "@/components/templates/DataTable";
import { PageHeader } from "@/components/templates/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { CLUB_ROLES, requirePageRole } from "@/server/auth/session";
import { requireSquadOrgPage } from "@/server/squad/access";
import { listTeams, type TeamSummary } from "@/server/squad/teams";
import { canEditSquad, metaText } from "../shared";

export const metadata = { title: "Teams" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function TeamTable({
  teams,
  caption,
  countHeader,
  countNoun,
}: {
  teams: TeamSummary[];
  caption: string;
  countHeader: string;
  countNoun: [string, string, string];
}) {
  return (
    <DataTable
      caption={caption}
      columns={[
        { id: "team", header: "Team" },
        { id: "season", header: "Season" },
        { id: "count", header: countHeader, numeric: true },
      ]}
      rows={teams.map((t) => {
        const labels = metaText([t.ageGroup, t.gender]);
        return {
          id: t.id,
          cells: [
            <span key="team">
              <Link
                href={`/squad/teams/${t.id}`}
                className="body-strong text-pitch underline break-words"
              >
                {t.name}
              </Link>
              {labels && <span className="caption block text-ink-muted">{labels}</span>}
            </span>,
            <span key="season" className="data">
              {t.season}
            </span>,
            t.activeCount,
          ],
        };
      })}
      cards={teams.map((t) => (
        <li key={t.id} className="wl-card flex flex-col gap-1">
          <Link
            href={`/squad/teams/${t.id}`}
            className="wl-link-row body-strong text-pitch underline break-words"
          >
            {t.name}
          </Link>
          <p className="caption text-ink-muted">
            {metaText([
              t.ageGroup,
              t.gender,
              t.season,
              t.activeCount === 0
                ? countNoun[2]
                : plural(t.activeCount, countNoun[0], countNoun[1]),
            ])}
          </p>
        </li>
      ))}
    />
  );
}

/**
 * The team list (SQUAD01, SQUAD07; docs/build/design/C04.md, Surface 3): the
 * club's teams and the opposition teams, each with active player counts.
 */
export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const ctx = requireSquadOrgPage(await requirePageRole(CLUB_ROLES));
  const { done } = await searchParams;
  const admin = canEditSquad(ctx.roles);
  const { own, opposition } = await listTeams(ctx);

  return (
    <>
      <PageHeader
        back={{ href: "/squad", label: "Squad" }}
        title="Teams"
        intro="Each team is one squad in one season. Opposition teams hold unnamed players for match lineups."
        actions={
          admin && (
            <ButtonLink variant="primary" icon={Plus} href="/squad/teams/new" block>
              Add team
            </ButtonLink>
          )
        }
      />
      <div aria-live="polite" className="mt-4 empty:mt-0">
        {done === "deleted" && <Banner tone="ok">Team deleted.</Banner>}
      </div>

      <section aria-labelledby="own-teams" className="mt-8">
        <h2 id="own-teams" tabIndex={-1} className="heading-2">
          Your teams
        </h2>
        {own.length === 0 ? (
          <p className="body-lg mt-4 text-ink-muted">
            {admin
              ? "No teams yet. Add a team for each squad and season, such as U15 Boys (2026)."
              : "No teams yet."}
          </p>
        ) : (
          <>
            <p className="caption mt-2 text-ink-muted">{plural(own.length, "team", "teams")}</p>
            <div className="mt-4">
              <TeamTable
                teams={own}
                caption="Your teams, by season"
                countHeader="Players"
                countNoun={["player", "players", "No players"]}
              />
            </div>
          </>
        )}
      </section>

      <section aria-labelledby="opposition-teams" className="mt-8">
        <h2 id="opposition-teams" tabIndex={-1} className="heading-2">
          Opposition teams
        </h2>
        <p className="body mt-2 max-w-prose text-ink-muted">
          Teams you play against. Their players are shirt numbers only, never names.
        </p>
        {admin && (
          <div className="mt-4">
            <ButtonLink variant="secondary" size="sm" href="/squad/teams/new?kind=opposition">
              Add opposition team
            </ButtonLink>
          </div>
        )}
        {opposition.length === 0 ? (
          <p className="body mt-4 text-ink-muted">
            {admin
              ? "No opposition teams yet. Add one when you set up a match against them."
              : "No opposition teams yet."}
          </p>
        ) : (
          <div className="mt-4">
            <TeamTable
              teams={opposition}
              caption="Opposition teams, by season"
              countHeader="Placeholders"
              countNoun={["placeholder", "placeholders", "No placeholders"]}
            />
          </div>
        )}
      </section>
    </>
  );
}
