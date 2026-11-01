import { ChevronRight, Search, Upload } from "lucide-react";
import Link from "next/link";
import { Banner } from "@/components/forms";
import { EmptyState } from "@/components/states/EmptyState";
import {
  DataListRow,
  DataTable,
  DataTablePagination,
  Missing,
} from "@/components/templates/DataTable";
import { ListPage } from "@/components/templates/ListPage";
import { Button, ButtonLink } from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icons";
import { SegmentedFilter } from "@/components/ui/SegmentedFilter";
import { MatchStatusChip } from "@/components/ui/StatusChip";
import { Select, TextField } from "@/components/ui/TextField";
import type { MatchStatus } from "@/generated/prisma/enums";
import { formatDate, teamLabel } from "@/lib/labels";
import { CLUB_ROLES, requirePageRole } from "@/server/auth/session";
import { requireSquadOrgPage } from "@/server/matches/access";
import { listMatchesByStatus, type MatchSummary } from "@/server/matches/matches";
import { listTeams } from "@/server/squad/teams";
import { doneMessage, FootageCell, OwnSideFixture, ownSide } from "./shared";

export const metadata = { title: "Matches" };

/** Rows per page of the one list, newest first. */
const PAGE_SIZE = 20;

const DONE = {
  deleted:
    "Match deleted. Its lineups and markers are gone. The footage file is deleted 7 days after upload.",
};

/** The filters group the seven statuses by who has to act (Screens A, "Matches list"). */
const FILTERS = [
  { value: "all", label: "All", statuses: null },
  { value: "needs-you", label: "Needs you", statuses: ["draft", "failed"] },
  {
    value: "in-progress",
    label: "In progress",
    statuses: ["uploading", "processing", "awaiting_review", "in_review"],
  },
  { value: "reviewed", label: "Reviewed", statuses: ["published"] },
] as const satisfies readonly {
  value: string;
  label: string;
  statuses: readonly MatchStatus[] | null;
}[];

type FilterValue = (typeof FILTERS)[number]["value"];

function isFilter(v: string | undefined): v is FilterValue {
  return FILTERS.some((f) => f.value === v);
}

function listHref(p: { team?: string | null; filter?: string; q?: string; page?: number }) {
  const params = new URLSearchParams();
  if (p.filter && p.filter !== "all") params.set("filter", p.filter);
  if (p.team) params.set("team", p.team);
  if (p.q) params.set("q", p.q);
  if (p.page && p.page > 1) params.set("page", String(p.page));
  const q = params.toString();
  return q ? `/matches?${q}` : "/matches";
}

/** The one action a row offers, when the club has something to do. */
function rowAction(m: MatchSummary): { label: string; href: string } | null {
  if (m.status === "uploading") return { label: "View upload", href: `/matches/${m.id}/upload` };
  if (m.status === "failed") return { label: "See why", href: `/matches/${m.id}#footage` };
  if (m.status === "draft" && (!m.video || m.video.status === "rejected")) {
    return { label: "Upload footage", href: `/matches/${m.id}/upload` };
  }
  return null;
}

/**
 * The Team cell (Screens A, 44px column): the age group ("U17") when the team name ends
 * in one, else the name, truncated with the full name as a tooltip.
 */
function TeamShort({ name }: { name: string }) {
  const short = /\b(U\d{1,2})$/i.exec(name.trim())?.[1]?.toUpperCase() ?? name;
  return (
    <span title={name} className="block truncate font-mono text-body-s text-ink-muted">
      {short !== name && <span className="sr-only">{name}</span>}
      <span aria-hidden={short !== name || undefined}>{short}</span>
    </span>
  );
}

/**
 * Matches (MATCH01, MATCH07; Floodlight Screens A, "Matches list"): all seven statuses in
 * one list, newest first, filtered by who has to act, by team and by opponent. Everything is
 * in the query string, so it works without JavaScript. Tablet drops to three columns; phones
 * get 76px rows.
 */
export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{
    team?: string;
    filter?: string;
    q?: string;
    page?: string;
    done?: string;
  }>;
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
      <ListPage header={{ title: "Matches", intro: `Matches for ${ctx.organisationName}.` }}>
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
  const filter: FilterValue = isFilter(params.filter) ? params.filter : "all";
  const q = (params.q ?? "").trim().slice(0, 80);
  const groups = await listMatchesByStatus(ctx, { teamId: team?.id });
  const now = new Date();
  const createHref = team ? `/matches/new?team=${team.id}` : "/matches/new";

  // One list, newest first. Opponent search narrows by either team's name.
  const needle = q.toLocaleLowerCase("en-ZA");
  const all = groups
    .flatMap((g) => g.matches)
    .filter(
      (m) =>
        !needle ||
        m.homeTeam.name.toLocaleLowerCase("en-ZA").includes(needle) ||
        m.awayTeam.name.toLocaleLowerCase("en-ZA").includes(needle),
    )
    .sort((a, b) => b.playedAt.getTime() - a.playedAt.getTime());
  const counts = Object.fromEntries(
    FILTERS.map((f) => [
      f.value,
      f.statuses === null
        ? all.length
        : all.filter((m) => (f.statuses as readonly MatchStatus[]).includes(m.status)).length,
    ]),
  ) as Record<FilterValue, number>;
  const current = FILTERS.find((f) => f.value === filter)!;
  const shown =
    current.statuses === null
      ? all
      : all.filter((m) => (current.statuses as readonly MatchStatus[]).includes(m.status));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1));
  const rows = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const base = { team: team?.id ?? null, filter, q };

  const filters = (
    <div className="mt-5 flex flex-col gap-3 touch:mt-3.5 tablet:flex-row tablet:flex-wrap tablet:items-end">
      <SegmentedFilter
        aria-label="Show matches"
        value={filter}
        className="touch:overflow-x-auto"
        options={FILTERS.map((f) => ({
          value: f.value,
          label: f.label,
          count: counts[f.value],
          href: listHref({ ...base, filter: f.value }),
        }))}
      />
      {/* Phones get the filter chips only (Screens A, "Matches · phone"). */}
      <form
        method="get"
        action="/matches"
        className="flex flex-col gap-3 touch:hidden tablet:ml-auto tablet:flex-row tablet:items-end"
      >
        {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
        {own.length >= 2 && (
          <Select
            id="matches-team"
            name="team"
            label="Team"
            defaultValue={team?.id ?? ""}
            className="tablet:w-44"
            options={[
              { value: "", label: "All teams" },
              ...own.map((t) => ({ value: t.id, label: teamLabel(t) })),
            ]}
          />
        )}
        <TextField
          id="matches-q"
          name="q"
          type="search"
          label="Opponent"
          placeholder="Search by opponent"
          defaultValue={q}
          className="tablet:w-60"
          trailing={<Search {...iconProps} />}
        />
        <Button type="submit" variant="secondary" block className="justify-center">
          Show
        </Button>
      </form>
    </div>
  );

  let content;
  if (all.length === 0 && (label || q)) {
    content = (
      <EmptyState
        art={false}
        title={q ? `No matches against ${q}` : `No matches for ${label}`}
        body={
          q ? "Check the spelling, or clear the search." : "Choose All teams to see every match."
        }
        action={
          <ButtonLink variant="secondary" href="/matches">
            Show all matches
          </ButtonLink>
        }
      />
    );
  } else if (all.length === 0) {
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
  } else if (shown.length === 0) {
    content = (
      <EmptyState
        art={false}
        title={
          filter === "needs-you"
            ? "Nothing needs you right now."
            : `No matches ${current.label.toLowerCase()}`
        }
        body="Choose All to see every match."
      />
    );
  } else {
    const footer =
      pages > 1 ? (
        <DataTablePagination
          from={(page - 1) * PAGE_SIZE + 1}
          to={(page - 1) * PAGE_SIZE + rows.length}
          total={shown.length}
          noun="matches"
          page={page}
          pages={pages}
          prevHref={page > 1 ? listHref({ ...base, page: page - 1 }) : undefined}
          nextHref={page < pages ? listHref({ ...base, page: page + 1 }) : undefined}
        />
      ) : undefined;
    content = (
      <>
        {/* Desktop: every column. */}
        <DataTable
          className="hidden desktop:block"
          caption="Matches, newest first"
          footer={footer}
          columns={[
            { id: "date", header: "Date", sort: "descending", width: "64px" },
            { id: "match", header: "Match" },
            { id: "team", header: "Team", width: "44px" },
            { id: "status", header: "Status", width: "176px" },
            { id: "footage", header: "Footage", width: "120px" },
            { id: "events", header: "Events", width: "132px", numeric: true },
            { id: "action", header: "", label: "Action", width: "112px" },
          ]}
          rows={rows.map((m) => {
            const action = rowAction(m);
            return {
              id: m.id,
              cells: [
                <span
                  key="date"
                  className="font-mono whitespace-nowrap text-ink-muted tabular-nums"
                >
                  {formatDate(m.playedAt)}
                </span>,
                <OwnSideFixture key="match" match={m} link />,
                <TeamShort
                  key="team"
                  name={(ownSide(m) === "home" ? m.homeTeam : m.awayTeam).name}
                />,
                <MatchStatusChip key="status" status={m.status} size="s" />,
                <FootageCell key="footage" match={m} now={now} />,
                // Event and lineup counts are not in MatchSummary yet (see openIssues).
                <Missing key="events" />,
                <span key="action" className="flex justify-end">
                  {action ? (
                    <ButtonLink variant="secondary" size="s" href={action.href}>
                      {action.label}
                    </ButtonLink>
                  ) : (
                    <Link
                      href={`/matches/${m.id}`}
                      className="grid size-8 place-items-center rounded-control text-ink-muted hover:bg-raised hover:text-ink"
                    >
                      <ChevronRight {...iconProps} size={16} />
                      <span className="sr-only">Open match</span>
                    </Link>
                  )}
                </span>,
              ],
            };
          })}
        />
        {/* Tablet: three columns. Phone: 76px rows, the whole row opens the match. */}
        <DataTable
          className="desktop:hidden"
          caption="Matches, newest first (compact)"
          footer={footer}
          columns={[
            { id: "match", header: "Match" },
            { id: "status", header: "Status", width: "168px" },
            { id: "footage", header: "Footage", width: "110px" },
          ]}
          rows={rows.map((m) => ({
            id: m.id,
            cells: [
              <span key="match" className="flex min-w-0 flex-col gap-1">
                <OwnSideFixture match={m} link />
                <span className="font-mono text-body-s text-ink-muted tabular-nums">
                  {formatDate(m.playedAt)} ·{" "}
                  {(ownSide(m) === "home" ? m.homeTeam : m.awayTeam).name}
                </span>
              </span>,
              <MatchStatusChip key="status" status={m.status} size="s" />,
              <FootageCell key="footage" match={m} now={now} />,
            ],
          }))}
          cards={rows.map((m) => (
            <DataListRow
              key={m.id}
              href={`/matches/${m.id}`}
              title={<OwnSideFixture match={m} />}
              meta={
                <span className="flex flex-wrap items-center gap-2">
                  <MatchStatusChip status={m.status} size="s" />
                  <span className="tabular-nums">
                    {formatDate(m.playedAt)} ·{" "}
                    {(ownSide(m) === "home" ? m.homeTeam : m.awayTeam).name}
                  </span>
                </span>
              }
            />
          ))}
        />
      </>
    );
  }

  return (
    <ListPage
      header={{
        title: (
          <span className="flex items-baseline justify-between gap-3">
            Matches
            <span className="hidden font-mono text-mono-l text-ink-muted normal-case tabular-nums touch:inline">
              <span className="sr-only">, </span>
              {all.length}
            </span>
          </span>
        ),
        intro: (
          <span className="font-mono text-body-s tabular-nums touch:hidden">
            {all.length} {all.length === 1 ? "match" : "matches"}
            {team && ` · ${team.name} · ${team.season} season`}
          </span>
        ),
        actions:
          all.length > 0 ? (
            <ButtonLink
              variant="primary"
              icon={Upload}
              block
              className="touch:h-row"
              href={createHref}
            >
              Upload match
            </ButtonLink>
          ) : undefined,
        children: all.length > 0 || label || q ? filters : undefined,
      }}
    >
      {banner}
      {content}
    </ListPage>
  );
}
