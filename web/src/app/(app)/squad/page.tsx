import {
  ChevronRight,
  CircleCheck,
  Clock,
  LogOut,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  ShieldHalf,
  ShieldOff,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/states/EmptyState";
import { DataListRow, DataTable, Missing, type DataColumn } from "@/components/templates/DataTable";
import { PageHeader } from "@/components/templates/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { ConsentBadge, consentBadgeState } from "@/components/ui/ConsentBadge";
import { cx } from "@/components/ui/cx";
import { iconProps, ICON_SIZE_DENSE } from "@/components/ui/icons";
import { initials } from "@/components/ui/PlayerCard";
import { SegmentedFilter, type SegmentOption } from "@/components/ui/SegmentedFilter";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { formatDate, playerName, teamLabel } from "@/lib/labels";
import { canUndoDeparture, positionLabel } from "@/lib/squad-fields";
import { CLUB_ROLES, requirePageRole } from "@/server/auth/session";
import { requireSquadOrgPage } from "@/server/squad/access";
import { countPlayers, listPlayers, type PlayerRow } from "@/server/squad/players";
import { listTeams } from "@/server/squad/teams";
import { RestorePlayer } from "./RestorePlayer";
import { canEditSquad } from "./shared";

export const metadata = { title: "Squad" };

type Status = "current" | "departed";
type ConsentKey = "all" | "given" | "club_only" | "awaiting" | "withdrawn" | "none";
const CONSENT_KEYS: readonly ConsentKey[] = [
  "all",
  "given",
  "club_only",
  "awaiting",
  "withdrawn",
  "none",
];

type Query = { team: string | null; status: Status; consent: ConsentKey; q: string };

function href({ team, status, consent, q }: Query) {
  const params = new URLSearchParams();
  if (team) params.set("team", team);
  if (status === "departed") params.set("status", "departed");
  if (status === "current" && consent !== "all") params.set("consent", consent);
  if (q) params.set("q", q);
  const s = params.toString();
  return s ? `/squad?${s}` : "/squad";
}

const icon = (Icon: LucideIcon, className?: string) => (
  <Icon {...iconProps} size={ICON_SIZE_DENSE} className={className} />
);

/** Consent filters: colour, icon and word (never colour alone). */
const FILTERS: Record<Exclude<ConsentKey, "all">, { label: string; icon: ReactNode }> = {
  given: { label: "Given", icon: icon(ShieldCheck, "text-confirmed") },
  club_only: { label: "Club only", icon: icon(ShieldHalf, "text-confirmed") },
  awaiting: { label: "Awaiting", icon: icon(Clock, "text-pending") },
  withdrawn: { label: "Withdrawn", icon: icon(ShieldOff, "text-rejected") },
  none: { label: "Not requested", icon: icon(Shield, "text-ink-muted") },
};

const consentKey = (p: PlayerRow): Exclude<ConsentKey, "all"> | null =>
  p.isPlaceholder ? null : consentBadgeState(p.consentState);

/**
 * What is blocking consent, and what the club can do about it, from the consent state. The
 * request dates and the guardian's email are on the player page; the action opens it.
 * Withdrawn consent is never chased. "none" covers both "never asked" and "the guardian
 * said no", which the list query cannot tell apart (Q-074), so it offers no action.
 */
function GuardianCell({ p, admin }: { p: PlayerRow; admin: boolean }) {
  const key = consentKey(p);
  if (!key) return <Missing />;
  const look: Record<
    Exclude<ConsentKey, "all">,
    { icon: LucideIcon; text: string; tone?: string; act?: string }
  > = {
    given: { icon: CircleCheck, text: "Answer recorded" },
    club_only: { icon: CircleCheck, text: "Answer recorded" },
    awaiting: { icon: Clock, text: "Request sent", act: "Remind" },
    none: { icon: Shield, text: "No consent" },
    withdrawn: { icon: ShieldOff, text: "Withdrawn" },
  };
  const l = look[key];
  return (
    <span className={cx("flex items-center gap-1.5 text-body-s", l.tone ?? "text-ink-muted")}>
      {icon(l.icon)}
      <span className="whitespace-nowrap">{l.text}</span>
      {admin && l.act && (
        <Link
          href={`/squad/players/${p.id}#consent`}
          className="font-semibold text-brand-text"
          aria-label={`${l.act} the guardian of ${playerName(p)}`}
        >
          {l.act}
        </Link>
      )}
    </span>
  );
}

function PlayerCell({ p, departed = false }: { p: PlayerRow; departed?: boolean }) {
  const name = playerName(p);
  return (
    <Link
      href={`/squad/players/${p.id}`}
      className={cx(
        "flex min-w-0 items-center gap-2.5 no-underline hover:underline",
        departed || p.isPlaceholder ? "text-ink-muted" : "text-ink",
      )}
    >
      <span
        className={cx("wl-avatar wl-avatar--s", departed && "wl-avatar--muted")}
        aria-hidden="true"
      >
        {p.isPlaceholder ? (p.squadNumber ?? "") : initials(name)}
      </span>
      <span
        className={cx(
          "truncate",
          p.isPlaceholder ? "font-normal" : departed ? "font-medium" : "font-semibold",
        )}
      >
        {name}
      </span>
    </Link>
  );
}

const number = (p: PlayerRow) =>
  p.squadNumber === null ? <Missing /> : <span className="font-mono">{p.squadNumber}</span>;

/**
 * The squad list (SQUAD02, SQUAD09; Floodlight, "Squad"): one tab per own team plus
 * Departed, consent filters with counts for the current tab, a table on desktop and 60px
 * rows on phones. Filters are query params, so it works without JavaScript. Opposition
 * placeholders never appear here.
 */
export default async function SquadPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; status?: string; consent?: string; q?: string }>;
}) {
  const ctx = requireSquadOrgPage(await requirePageRole(CLUB_ROLES));
  const params = await searchParams;
  const admin = canEditSquad(ctx.roles);
  const { own } = await listTeams(ctx);
  const team = own.find((t) => t.id === params.team) ?? null;
  const teamId = team?.id ?? null;
  const status: Status = params.status === "departed" ? "departed" : "current";
  const consent: ConsentKey = CONSENT_KEYS.includes(params.consent as ConsentKey)
    ? (params.consent as ConsentKey)
    : "all";
  const q = (params.q ?? "").trim().slice(0, 80);
  const query: Query = { team: teamId, status, consent, q };
  const org = ctx.organisationName;
  const teamQuery = teamId ? `?team=${teamId}` : "";

  const teamsLink = (
    <ButtonLink variant="ghost" icon={Users} href="/squad/teams">
      Teams
    </ButtonLink>
  );

  if (own.length === 0) {
    return (
      <>
        <PageHeader title="Squad" intro={`Players in ${org}.`} actions={teamsLink} />
        <div className="mt-6">
          <EmptyState
            icon={Users}
            title="No teams yet"
            body={
              admin
                ? "Add your first team, such as U15 Boys for the 2026 season. Then add players one by one or import them from a CSV file."
                : `An owner or admin of ${org} adds teams and players.`
            }
            action={
              admin ? (
                <ButtonLink variant="primary" icon={Plus} href="/squad/teams/new">
                  Add team
                </ButtonLink>
              ) : undefined
            }
          />
        </div>
      </>
    );
  }

  const [counts, players] = await Promise.all([
    countPlayers(ctx, { teamId }),
    listPlayers(ctx, { teamId, status }),
  ]);
  const showTeam =
    status === "departed" || (!teamId && (own.length > 1 || players.some((p) => !p.team)));
  const label = team ? teamLabel(team) : null;

  // Consent counts for the current tab, then the filter and the search on top.
  const tally = { given: 0, club_only: 0, awaiting: 0, withdrawn: 0, none: 0 };
  for (const p of players) {
    const k = consentKey(p);
    if (k) tally[k] += 1;
  }
  const needle = q.toLocaleLowerCase("en-ZA");
  const shown = players.filter(
    (p) =>
      (status === "departed" || consent === "all" || consentKey(p) === consent) &&
      (!needle || playerName(p).toLocaleLowerCase("en-ZA").includes(needle)),
  );
  // Only requests still waiting on a guardian are chased: "none" may be a guardian's no.
  const chase = tally.awaiting;

  const tabs: TabItem[] = [
    ...(own.length > 1
      ? [
          {
            value: "all",
            label: "All teams",
            count: status === "current" && !teamId ? counts.current : undefined,
            href: href({ ...query, team: null, status: "current", consent: "all" }),
          },
        ]
      : []),
    ...own.map((t) => ({
      value: t.id,
      label: teamLabel(t),
      count: status === "current" && t.id === teamId ? counts.current : undefined,
      href: href({ ...query, team: t.id, status: "current", consent: "all" }),
    })),
    {
      value: "departed",
      label: "Departed",
      count: counts.departed,
      href: href({ ...query, status: "departed", consent: "all" }),
    },
  ];
  const tabValue =
    status === "departed" ? "departed" : (teamId ?? (own.length > 1 ? "all" : own[0]!.id));

  const filterOptions: SegmentOption[] = [
    {
      value: "all",
      label: "All",
      count: players.length,
      icon: icon(Users, "text-ink-muted"),
      href: href({ ...query, consent: "all" }),
    },
    ...(Object.keys(FILTERS) as (keyof typeof FILTERS)[])
      .filter((k) => k !== "club_only" || tally.club_only > 0)
      .map((k) => ({
        value: k,
        label: FILTERS[k].label,
        count: tally[k],
        icon: FILTERS[k].icon,
        href: href({ ...query, consent: k }),
      })),
  ];

  const search = (
    <form method="get" action="/squad" role="search" className="tablet:ml-auto">
      {teamId && <input type="hidden" name="team" value={teamId} />}
      {status === "departed" && <input type="hidden" name="status" value="departed" />}
      {status === "current" && consent !== "all" && (
        <input type="hidden" name="consent" value={consent} />
      )}
      <label className="flex h-control-l w-full items-center gap-2.5 rounded-control border border-control bg-raised px-2.5 text-ink-muted has-[:focus-visible]:ring-focus tablet:h-control-m tablet:w-60">
        <Search {...iconProps} size={17} />
        <span className="sr-only">Search players</span>
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search players"
          className="min-w-0 flex-1 border-0 bg-transparent text-ink outline-none placeholder:text-ink-muted"
        />
      </label>
    </form>
  );

  const meta =
    status === "departed"
      ? `${counts.departed} departed${label ? ` from ${label}` : ""}`
      : `${counts.current} ${counts.current === 1 ? "player" : "players"} ${
          label ? `in ${label}` : `in ${own.length} ${own.length === 1 ? "team" : "teams"}`
        } · ${counts.departed} departed`;

  // An empty current squad keeps its one primary in the empty state.
  const emptyCurrent = status === "current" && players.length === 0;
  const actions = (
    <>
      {admin && !emptyCurrent && (
        <>
          <ButtonLink
            variant="secondary"
            icon={Upload}
            href={`/squad/import${teamQuery}`}
            className="hidden tablet:inline-flex"
          >
            Import from CSV
          </ButtonLink>
          <ButtonLink variant="primary" icon={Plus} href={`/squad/players/new${teamQuery}`}>
            Add player
          </ButtonLink>
        </>
      )}
      {teamsLink}
    </>
  );

  let content: ReactNode;
  if (players.length === 0) {
    content =
      status === "departed" ? (
        <EmptyState
          icon={LogOut}
          title={label ? `No departed players in ${label}` : "No departed players"}
          body="Players you mark as departed are listed here. Their records stay."
        />
      ) : admin ? (
        <EmptyState
          icon={Users}
          title={label ? `No players in ${label} yet` : "No players yet"}
          body="Add your squad so you can enter lineups and ask guardians for consent."
          action={
            <ButtonLink variant="primary" icon={Plus} href={`/squad/players/new${teamQuery}`}>
              Add player
            </ButtonLink>
          }
          secondary={
            <ButtonLink variant="secondary" icon={Upload} href={`/squad/import${teamQuery}`}>
              Import from a spreadsheet
            </ButtonLink>
          }
        />
      ) : (
        <EmptyState
          icon={Users}
          title="No players yet"
          body={`An owner or admin of ${org} adds the squad.`}
        />
      );
  } else if (shown.length === 0) {
    content = (
      <EmptyState
        icon={Search}
        title="No players match"
        body="Try another consent filter or search."
        action={
          <ButtonLink variant="secondary" href={href({ ...query, consent: "all", q: "" })}>
            Show all players
          </ButtonLink>
        }
      />
    );
  } else if (status === "current") {
    const columns: DataColumn[] = [
      { id: "no", header: "No.", numeric: true, width: "48px" },
      { id: "name", header: "Player" },
      { id: "position", header: "Position" },
      { id: "consent", header: "Consent" },
      { id: "guardian", header: "Guardian" },
      ...(showTeam ? [{ id: "team", header: "Team" }] : []),
    ];
    const departedLink =
      counts.departed > 0 ? (
        <Link
          href={href({ ...query, status: "departed", consent: "all", q: "" })}
          className="mt-6 flex w-fit min-h-control-l items-center gap-2.5 text-ink no-underline hover:underline tablet:min-h-control-m"
        >
          <span className="font-display text-heading-section uppercase stretch-wide">
            {label ? `Departed from ${label}` : "Departed"}
          </span>
          <span className="font-mono text-mono-m text-ink-muted tabular-nums">
            {counts.departed}
          </span>
          <ChevronRight {...iconProps} className="text-ink-muted" />
        </Link>
      ) : null;
    content = (
      <>
        <DataTable
          caption={
            label
              ? `Current players in ${label}, by shirt number`
              : "Current players, by team and shirt number"
          }
          columns={columns}
          rows={shown.map((p) => ({
            id: p.id,
            cells: [
              number(p),
              <PlayerCell key="name" p={p} />,
              positionLabel(p.position) ?? <Missing />,
              p.isPlaceholder ? (
                <Missing key="consent" />
              ) : (
                <ConsentBadge state={p.consentState} size="s" />
              ),
              <GuardianCell key="guardian" p={p} admin={admin} />,
              ...(showTeam
                ? [
                    <span key="team" className="break-words">
                      {p.team ? teamLabel(p.team) : <Missing />}
                    </span>,
                  ]
                : []),
            ],
          }))}
          footer={
            <span>
              Showing <span className="font-mono">{shown.length}</span> of{" "}
              <span className="font-mono">{players.length}</span>
            </span>
          }
          cards={shown.map((p) => (
            <DataListRow
              key={p.id}
              href={`/squad/players/${p.id}`}
              initials={p.squadNumber === null ? initials(playerName(p)) : String(p.squadNumber)}
              title={playerName(p)}
              meta={
                [positionLabel(p.position), showTeam && p.team ? teamLabel(p.team) : null]
                  .filter(Boolean)
                  .join(" · ") || undefined
              }
              status={
                p.isPlaceholder ? undefined : <ConsentBadge state={p.consentState} iconOnly />
              }
            />
          ))}
        />
        {departedLink}
      </>
    );
  } else {
    content = (
      <section aria-labelledby="squad-departed" className="flex flex-col gap-2.5">
        <h2
          id="squad-departed"
          className="m-0 flex items-baseline gap-2.5 font-display text-heading-section uppercase stretch-wide"
        >
          {label ? `Departed from ${label}` : "Departed"}
          <span className="font-mono text-mono-m text-ink-muted tabular-nums normal-case">
            {shown.length}
          </span>
        </h2>
        <DataTable
          caption={
            label ? `Departed players in ${label}, by date left` : "Departed players, by date left"
          }
          columns={[
            { id: "no", header: "No.", numeric: true, width: "48px" },
            { id: "name", header: "Player" },
            { id: "left", header: "Left" },
            { id: "scouts", header: "Scouts" },
            ...(showTeam ? [{ id: "team", header: "Team" }] : []),
            { id: "restore", header: "", label: "Restore" },
          ]}
          rows={shown.map((p) => ({
            id: p.id,
            muted: true,
            cells: [
              number(p),
              <PlayerCell key="name" p={p} departed />,
              <span key="left" className="flex items-center gap-1.5 whitespace-nowrap">
                {icon(LogOut)}
                {p.departedAt ? `Left on ${formatDate(p.departedAt)}` : <Missing />}
              </span>,
              <span key="scouts" className="text-body-s">
                Hidden from scouts
              </span>,
              ...(showTeam
                ? [
                    <span key="team" className="break-words">
                      {p.team ? teamLabel(p.team) : <Missing />}
                    </span>,
                  ]
                : []),
              admin && canUndoDeparture(p.departedAt) ? (
                <RestorePlayer key="restore" playerId={p.id} name={playerName(p)} />
              ) : (
                <span key="restore" />
              ),
            ],
          }))}
          cards={shown.map((p) => (
            <DataListRow
              key={p.id}
              href={`/squad/players/${p.id}`}
              initials={initials(playerName(p))}
              title={playerName(p)}
              meta={[
                p.departedAt ? `Left on ${formatDate(p.departedAt)}` : null,
                "Hidden from scouts",
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          ))}
        />
      </section>
    );
  }

  return (
    <>
      <PageHeader
        title="Squad"
        intro={<span className="font-mono text-mono-m">{meta}</span>}
        actions={actions}
      >
        <Tabs items={tabs} value={tabValue} aria-label="Teams" />
      </PageHeader>
      {status === "current" && players.length > 0 && admin && chase > 0 && consent === "all" && (
        <Link
          href={href({ ...query, consent: "awaiting" })}
          className="mt-4 flex items-center gap-3 border-pending px-3.5 py-3 text-ink no-underline tablet:hidden"
        >
          <Shield {...iconProps} className="text-pending" />
          <span className="flex-1 font-medium">
            {chase} {chase === 1 ? "player" : "players"} without consent
          </span>
          <span className="font-semibold text-brand-text">Chase</span>
        </Link>
      )}
      {players.length > 0 && (
        <div className="mt-5 flex flex-col gap-3 tablet:flex-row tablet:items-center">
          {status === "current" && (
            <div className="-mx-1 overflow-x-auto px-1">
              <SegmentedFilter options={filterOptions} value={consent} aria-label="Consent" />
            </div>
          )}
          {search}
        </div>
      )}
      <div className="mt-4">{content}</div>
    </>
  );
}
