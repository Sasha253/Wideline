import { Plus } from "lucide-react";
import Link from "next/link";
import { Banner } from "@/components/forms";
import { EmptyState } from "@/components/states/EmptyState";
import { DataTable, Missing } from "@/components/templates/DataTable";
import { ListPage } from "@/components/templates/ListPage";
import { Button, ButtonLink } from "@/components/ui/Button";
import { MATCH_STATES, MatchStatusChip } from "@/components/ui/StatusChip";
import type { MatchStatus } from "@/generated/prisma/enums";
import { formatDate, teamLabel } from "@/lib/labels";
import { CLUB_ROLES, requirePageRole } from "@/server/auth/session";
import { requireSquadOrgPage } from "@/server/matches/access";
import { listMatchesByStatus, type MatchSummary } from "@/server/matches/matches";
import { listTeams } from "@/server/squad/teams";
import { doneMessage, FixtureMarkers, FootageLine, MatchLink } from "./shared";

export const metadata = { title: "Matches" };

/** The published group shows this many newest matches unless asked for all. */
const PUBLISHED_SHOWN = 10;

const DONE = {
  deleted:
    "Match deleted. Its lineups and markers are gone. The footage file is deleted 7 days after upload.",
};

function listHref(teamId: string | null, allPublished: boolean) {
  const params = new URLSearchParams();
  if (teamId) params.set("team", teamId);
  if (allPublished) params.set("published", "all");
  const q = params.toString();
  return q ? `/matches?${q}` : "/matches";
}

/**
 * Matches by status (MATCH01, MATCH07; docs/build/design/C06.md, Surface 1).
 * Filtered by team with query params, so it works without JavaScript. The
 * Published group shows the 10 newest unless published=all.
 */
export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; published?: string; done?: string }>;
}) {
  const ctx = requireSquadOrgPage(await requirePageRole(CLUB_ROLES));
  const params = await searchParams;
  const { own } = await listTeams(ctx);
  const done = doneMessage(DONE, params.done);
  const banner = (
    <div aria-live="polite" className="mb-6 empty:mb-0">
      {done && <Banner tone="ok">{done}</Banner>}
    </div>
  );

  if (own.length === 0) {
    return (
      <ListPage
        header={{ title: "Matches", intro: `Matches for ${ctx.organisationName}, by status.` }}
      >
        {banner}
        <EmptyState
          title="Add a team first"
          body="A match needs your team and the opposition. Add them in Squad."
          action={
            <ButtonLink variant="primary" href="/squad/teams">
              Go to teams
            </ButtonLink>
          }
        />
      </ListPage>
    );
  }

  const team = own.find((t) => t.id === params.team) ?? null;
  const label = team ? teamLabel(team) : null;
  const allPublished = params.published === "all";
  const groups = await listMatchesByStatus(ctx, { teamId: team?.id });
  const total = groups.reduce((n, g) => n + g.matches.length, 0);
  const now = new Date();
  const createHref = team ? `/matches/new?team=${team.id}` : "/matches/new";

  const toolbar =
    own.length >= 2 ? (
      <form method="get" action="/matches" className="wl-inline-form mb-6 w-full max-w-xl">
        <div className="wl-field">
          <label htmlFor="matches-team" className="label">
            Team
          </label>
          <select id="matches-team" name="team" className="wl-input" defaultValue={team?.id ?? ""}>
            <option value="">All teams</option>
            {own.map((t) => (
              <option key={t.id} value={t.id}>
                {teamLabel(t)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary" block className="justify-center">
          Show
        </Button>
      </form>
    ) : null;

  let content;
  if (total === 0 && label) {
    content = (
      <EmptyState
        art={false}
        title={`No matches for ${label}`}
        body="Choose All teams to see every match."
      />
    );
  } else if (total === 0) {
    content = (
      <EmptyState
        title="No matches yet"
        body="Create a match, upload the recording, then enter the lineups."
        action={
          <ButtonLink variant="primary" href={createHref}>
            Create match
          </ButtonLink>
        }
      />
    );
  } else {
    content = groups.map((g, i) => {
      const capped = g.status === "published" && !allPublished;
      const shown = capped ? g.matches.slice(0, PUBLISHED_SHOWN) : g.matches;
      return (
        <StatusGroup
          key={g.status}
          status={g.status}
          matches={shown}
          total={g.matches.length}
          first={i === 0}
          now={now}
          more={
            g.status !== "published" ? null : capped && g.matches.length > PUBLISHED_SHOWN ? (
              <Link
                href={listHref(team?.id ?? null, true)}
                className="body wl-link-row text-pitch underline"
              >
                Show all {g.matches.length} published matches
              </Link>
            ) : allPublished && g.matches.length > PUBLISHED_SHOWN ? (
              <Link
                href={listHref(team?.id ?? null, false)}
                className="body wl-link-row text-pitch underline"
              >
                Show the 10 newest
              </Link>
            ) : null
          }
        />
      );
    });
  }

  return (
    <ListPage
      header={{
        title: "Matches",
        intro: label
          ? `Matches for ${label}, by status.`
          : `Matches for ${ctx.organisationName}, by status.`,
        actions:
          total > 0 ? (
            <ButtonLink variant="primary" icon={Plus} href={createHref}>
              Create match
            </ButtonLink>
          ) : undefined,
      }}
    >
      {banner}
      {toolbar}
      {content}
    </ListPage>
  );
}

function StatusGroup({
  status,
  matches,
  total,
  first,
  now,
  more,
}: {
  status: MatchStatus;
  matches: MatchSummary[];
  total: number;
  first: boolean;
  now: Date;
  more: React.ReactNode;
}) {
  const label = MATCH_STATES[status].label;
  const id = `group-${status}`;
  return (
    <section aria-labelledby={id} className={first ? undefined : "mt-8"}>
      <h2 id={id} className="heading-2 mb-4">
        {label} <span className="data ml-2 text-ink-muted">{total}</span>
        <span className="sr-only"> {total === 1 ? "match" : "matches"}</span>
      </h2>
      <DataTable
        caption={`${label} matches, newest first`}
        columns={[
          { id: "match", header: "Match" },
          { id: "date", header: "Date" },
          { id: "competition", header: "Competition" },
          { id: "footage", header: "Footage" },
          { id: "status", header: "Status" },
        ]}
        rows={matches.map((m) => ({
          id: m.id,
          cells: [
            <MatchLink key="match" match={m} />,
            <span key="date" className="data whitespace-nowrap">
              {formatDate(m.playedAt)}
            </span>,
            m.competition ?? <Missing key="competition" />,
            <FootageLine key="footage" match={m} now={now} />,
            <MatchStatusChip key="status" status={m.status} />,
          ],
        }))}
        cards={matches.map((m) => (
          <li key={m.id} className="wl-card flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <Link
                href={`/matches/${m.id}`}
                className="wl-link-row body-strong min-w-0 text-pitch underline"
              >
                <FixtureMarkers match={m} stacked />
              </Link>
              <MatchStatusChip status={m.status} />
            </div>
            <p className="caption text-ink-muted">
              <span className="data">{formatDate(m.playedAt)}</span>
              {m.competition && <> · {m.competition}</>}
            </p>
            <div>
              <FootageLine match={m} now={now} />
            </div>
          </li>
        ))}
      />
      {more && <div className="mt-2">{more}</div>}
    </section>
  );
}
