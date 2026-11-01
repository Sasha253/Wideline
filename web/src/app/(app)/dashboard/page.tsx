import {
  ChevronRight,
  CircleAlert,
  Clock,
  File,
  Mail,
  Plus,
  Shield,
  ShieldCheck,
  ShieldHalf,
  ShieldOff,
  Upload,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/states/EmptyState";
import { DataTable } from "@/components/templates/DataTable";
import { PageHeader } from "@/components/templates/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { ConsentBadge, consentBadgeState } from "@/components/ui/ConsentBadge";
import { cx } from "@/components/ui/cx";
import { iconProps } from "@/components/ui/icons";
import { MatchStatusChip } from "@/components/ui/StatusChip";
import type { MatchStatus } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/labels";
import { CLUB_ROLES, requirePageRole } from "@/server/auth/session";
import { isSquadOrg } from "@/server/squad/access";
import { listMatchesByStatus, STATUS_ORDER, type MatchSummary } from "@/server/matches/matches";
import { listPlayers, type PlayerRow } from "@/server/squad/players";
import { listTeams } from "@/server/squad/teams";
import { opponentText, OwnSideFixture, ownSide } from "../matches/shared";

export const metadata = { title: "Dashboard" };

/** The matches-list filter each status belongs to (see matches/page.tsx). */
const FILTER_OF: Record<MatchStatus, string> = {
  draft: "needs-you",
  failed: "needs-you",
  uploading: "in-progress",
  processing: "in-progress",
  awaiting_review: "in-progress",
  in_review: "in-progress",
  published: "reviewed",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Text that reads one way from 768px and another on phones ("Matches by status" / "Matches"). */
function Responsive({ wide, phone }: { wide: string; phone?: string }) {
  if (!phone || phone === wide) return <>{wide}</>;
  return (
    <>
      <span className="touch:hidden">{wide}</span>
      <span className="hidden touch:inline">{phone}</span>
    </>
  );
}

function SectionHead({
  id,
  title,
  phoneTitle,
  link,
}: {
  id: string;
  title: string;
  phoneTitle?: string;
  link?: { href: string; label: string; phoneLabel?: string };
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 touch:px-1">
      <h2 id={id} className="font-display text-heading-section stretch-wide uppercase">
        <Responsive wide={title} phone={phoneTitle} />
      </h2>
      {link && (
        <Link
          href={link.href}
          className="text-label text-brand-text underline-offset-3 hover:underline"
        >
          <Responsive wide={link.label} phone={link.phoneLabel} />
        </Link>
      )}
    </div>
  );
}

type Need = {
  key: string;
  icon: LucideIcon;
  disc: string;
  title: string;
  sub: string;
  /** The phone form of `sub` (Screens A, "Dashboard · phone"). */
  shortSub?: string;
  action: string;
  href: string;
};

function playerName(p: PlayerRow) {
  return [p.firstName, p.lastName].filter(Boolean).join(" ") || "Unnamed player";
}

function playerInitials(p: PlayerRow) {
  return `${p.firstName?.[0] ?? ""}${p.lastName?.[0] ?? ""}`.toUpperCase() || "?";
}

type Segment = {
  key: string;
  n: number;
  label: string;
  icon: LucideIcon;
  iconClass: string;
  barClass: string;
};

function consentSegments(players: PlayerRow[]): Segment[] {
  const count = (s: string) =>
    players.filter((p) => consentBadgeState(p.consentState) === s).length;
  return (
    [
      {
        key: "given",
        n: count("given"),
        label: "given",
        icon: ShieldCheck,
        iconClass: "text-confirmed",
        barClass: "bg-confirmed",
      },
      {
        key: "club_only",
        n: count("club_only"),
        label: "club only",
        icon: ShieldHalf,
        iconClass: "text-confirmed",
        barClass: "bg-confirmed-subtle border border-confirmed",
      },
      {
        key: "awaiting",
        n: count("awaiting"),
        label: "awaiting",
        icon: Clock,
        iconClass: "text-pending",
        barClass: "border-pending",
      },
      {
        key: "withdrawn",
        n: count("withdrawn"),
        label: "withdrawn",
        icon: ShieldOff,
        iconClass: "text-rejected",
        barClass: "bg-rejected-subtle border border-rejected",
      },
      {
        key: "none",
        n: count("none"),
        label: "not requested",
        icon: Shield,
        iconClass: "text-ink-muted",
        barClass: "bg-selected border border-line-strong",
      },
    ] satisfies Segment[]
  ).filter((s) => s.n > 0);
}

/**
 * The club dashboard (Floodlight Screens A, "Club dashboard"): what needs the club first,
 * then matches by status, the latest matches, squad consent per team and the consent gaps
 * to chase. Withdrawn consent is a decision, so it is never chased. Counts are plain
 * numbers: no charts, no trends.
 */
export default async function DashboardPage() {
  const ctx = await requirePageRole(CLUB_ROLES);

  const empty = (action?: ReactNode) => (
    <>
      <PageHeader title="Dashboard" intro={`${ctx.organisationName} at a glance.`} />
      <div className="mt-6">
        <EmptyState
          title="Nothing to show yet"
          body="Your squad, matches by status and consent gaps appear here once your club adds players and uploads matches."
          action={action}
        />
      </div>
    </>
  );

  // Organisations without a squad (scouting organisations) have nothing to show here.
  if (!isSquadOrg(ctx.organisationType)) return empty();

  // No team yet: nothing to count, and the first step is adding one.
  const { own } = await listTeams(ctx);
  if (own.length === 0) {
    return empty(
      <ButtonLink variant="primary" href="/squad/teams">
        Go to teams
      </ButtonLink>,
    );
  }

  const [players, groups] = await Promise.all([
    listPlayers(ctx, { status: "current" }),
    listMatchesByStatus(ctx, {}),
  ]);
  const matches = groups.flatMap((g) => g.matches);
  const latest = [...matches].sort((a, b) => b.playedAt.getTime() - a.playedAt.getTime());

  const state = (p: PlayerRow) => consentBadgeState(p.consentState);
  const awaiting = players.filter((p) => state(p) === "awaiting");
  const notRequested = players.filter((p) => state(p) === "none");
  const withdrawn = players.filter((p) => state(p) === "withdrawn").length;
  const gaps = [...awaiting, ...notRequested];
  const noFootage = latest.filter(
    (m) => m.status === "draft" && (!m.video || m.video.status === "rejected"),
  );
  const failed = latest.filter((m) => m.status === "failed");

  const needs: Need[] = [];
  if (gaps.length > 0) {
    needs.push({
      key: "consent",
      icon: Shield,
      disc: "border-pending text-pending",
      title: `${plural(gaps.length, "player", "players")} without consent`,
      sub: `${awaiting.length} awaiting a guardian · ${notRequested.length} not requested yet`,
      shortSub: `${awaiting.length} awaiting · ${notRequested.length} not requested`,
      action: "Chase consent",
      href: "#consent-gaps",
    });
  }
  if (noFootage.length > 0) {
    const first = noFootage[0]!;
    needs.push({
      key: "footage",
      icon: File,
      disc: "border border-control text-ink",
      title: `${plural(noFootage.length, "match needs", "matches need")} footage`,
      sub: `${opponentText(first)} · ${formatDate(first.playedAt)}`,
      action: "Upload footage",
      href: noFootage.length === 1 ? `/matches/${first.id}/upload` : "/matches?filter=needs-you",
    });
  }
  if (failed.length > 0) {
    const first = failed[0]!;
    needs.push({
      key: "failed",
      icon: CircleAlert,
      disc: "bg-rejected-subtle text-rejected",
      title: `${plural(failed.length, "match", "matches")} failed processing`,
      sub: `${opponentText(first)} · ${formatDate(first.playedAt)}`,
      action: "See why",
      href: failed.length === 1 ? `/matches/${first.id}#footage` : "/matches?filter=needs-you",
    });
  }

  const statusCounts = STATUS_ORDER.map((s) => ({
    status: s,
    n: matches.filter((m) => m.status === s).length,
  }));
  // Phones show the four statuses where something is moving or stuck.
  const PHONE: MatchStatus[] = ["awaiting_review", "in_review", "processing", "failed"];

  const teams = own.map((t) => ({
    team: t,
    players: players.filter((p) => p.teamId === t.id),
  }));

  const meta = [plural(own.length, "team", "teams"), plural(players.length, "player", "players")];

  return (
    <>
      <PageHeader
        title="Dashboard"
        intro={
          <span className="font-mono text-body-s text-ink-muted tabular-nums">
            {meta.join(" · ")}
            {/* Phones show teams and players only (Screens A, "Dashboard · phone"). */}
            <span className="touch:hidden">
              {` · ${plural(matches.length, "match", "matches")}`}
            </span>
          </span>
        }
        actions={
          <ButtonLink
            variant="primary"
            icon={Upload}
            block
            href="/matches/new"
            className="touch:hidden"
          >
            Upload match
          </ButtonLink>
        }
      />

      <div className="mt-7 flex flex-col gap-7 touch:mt-5 touch:gap-5.5">
        {/* Needs you */}
        <section aria-labelledby="needs-you" className="flex flex-col gap-3 touch:gap-2.5">
          <SectionHead id="needs-you" title="Needs you" />
          {needs.length === 0 ? (
            <p className="border border-line bg-panel px-4.5 py-4 text-ink-muted">
              Nothing needs you right now.
            </p>
          ) : (
            <ul
              role="list"
              className="grid border border-line bg-panel tablet:grid-cols-3 tablet:[&>li:not(:last-child)]:border-r touch:[&>li:not(:last-child)]:border-b"
            >
              {needs.map((n) => (
                <li key={n.key} className="border-line">
                  <Link
                    href={n.href}
                    className="grid h-full grid-cols-[36px_minmax(0,1fr)] gap-3.5 px-4.5 py-4 hover:bg-raised touch:min-h-16 touch:grid-cols-[36px_minmax(0,1fr)_16px] touch:items-center touch:gap-3 touch:px-3.5 touch:py-2.5"
                  >
                    <span
                      className={cx("grid size-9 place-items-center rounded-full", n.disc)}
                      aria-hidden
                    >
                      <n.icon {...iconProps} size={17} />
                    </span>
                    <span className="flex min-w-0 flex-col gap-1.5">
                      <span className="leading-tight font-semibold">{n.title}</span>
                      <span className="text-body-s text-ink-muted">
                        <Responsive wide={n.sub} phone={n.shortSub} />
                      </span>
                      <span className="mt-1 flex items-center gap-1 text-label text-brand-text touch:hidden">
                        {n.action}
                        <ChevronRight {...iconProps} size={14} />
                      </span>
                    </span>
                    <ChevronRight
                      {...iconProps}
                      size={16}
                      className="hidden text-ink-muted touch:block"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Matches by status */}
        <section aria-labelledby="by-status" className="flex flex-col gap-3 touch:gap-2.5">
          <SectionHead
            id="by-status"
            title="Matches by status"
            phoneTitle="Matches"
            link={{
              href: "/matches",
              label: `All ${matches.length} matches`,
              phoneLabel: `All ${matches.length}`,
            }}
          />
          <ul
            role="list"
            className="grid grid-cols-2 gap-px border border-line bg-line tablet:grid-cols-4 desktop:grid-cols-7"
          >
            {statusCounts.map(({ status, n }, i) => (
              <li
                key={status}
                className={cx(
                  "bg-panel",
                  !PHONE.includes(status) && "touch:hidden",
                  // Seven tiles in four columns: the last one fills the row, so no empty
                  // line-coloured cell shows at tablet.
                  i === statusCounts.length - 1 && "tablet:col-span-2 desktop:col-span-1",
                )}
              >
                <Link
                  href={`/matches?filter=${FILTER_OF[status]}`}
                  className="flex h-full flex-col gap-3 py-3.5 pr-3 pl-3.5 hover:bg-raised"
                >
                  <span className="font-display text-display-phone font-bold stretch-wide tabular-nums touch:text-stat-m">
                    {n}
                  </span>
                  <span className="flex">
                    <MatchStatusChip status={status} size="s" />
                  </span>
                  <span className="sr-only">{n === 1 ? "match" : "matches"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <div className="grid items-start gap-6 desktop:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          {/* Latest matches: not on phones (Screens A, "Dashboard · phone"). */}
          <section aria-labelledby="latest" className="hidden flex-col gap-3 tablet:flex">
            <SectionHead
              id="latest"
              title="Latest matches"
              link={{ href: "/matches", label: "See all" }}
            />
            {latest.length === 0 ? (
              <p className="border border-line bg-panel px-4 py-4 text-ink-muted">
                No matches yet. Create a match, upload the recording, then enter the lineups.
              </p>
            ) : (
              <DataTable
                caption="Latest matches"
                columns={[
                  { id: "date", header: "Date", width: "56px" },
                  { id: "match", header: "Opponent" },
                  { id: "team", header: "Team", width: "72px" },
                  { id: "status", header: "Status", width: "150px" },
                  { id: "open", header: "", label: "Open", width: "16px" },
                ]}
                rows={latest.slice(0, 5).map((m: MatchSummary) => ({
                  id: m.id,
                  cells: [
                    <span
                      key="d"
                      className="font-mono whitespace-nowrap text-ink-muted tabular-nums"
                    >
                      {formatDate(m.playedAt)}
                    </span>,
                    <OwnSideFixture key="m" match={m} link />,
                    <span key="t" className="font-mono text-body-s text-ink-muted">
                      {(ownSide(m) === "home" ? m.homeTeam : m.awayTeam).name}
                    </span>,
                    <MatchStatusChip key="s" status={m.status} size="s" />,
                    <ChevronRight
                      key="o"
                      {...iconProps}
                      size={16}
                      aria-hidden
                      className="text-ink-muted"
                    />,
                  ],
                }))}
              />
            )}
          </section>

          <div className="flex flex-col gap-6 touch:gap-5.5">
            {/* Squad consent per team */}
            <section aria-labelledby="squad-consent" className="flex flex-col gap-3 touch:gap-2.5">
              <SectionHead
                id="squad-consent"
                title="Squad consent"
                link={{ href: "/squad", label: "Squad" }}
              />
              {teams.length === 0 ? (
                <p className="border border-line bg-panel px-4 py-4 text-ink-muted">
                  Add a team to see consent here.
                </p>
              ) : (
                <ul role="list" className="border border-line bg-panel">
                  {teams.map(({ team, players: tp }) => {
                    const segs = consentSegments(tp);
                    const given = tp.filter((p) => state(p) === "given").length;
                    return (
                      <li key={team.id} className="border-b border-line last:border-b-0">
                        <Link
                          href={`/squad?team=${team.id}`}
                          className="flex flex-col gap-2.5 px-4 py-3.5 hover:bg-raised touch:gap-2 touch:px-3.5 touch:py-3"
                        >
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="flex items-baseline gap-2.5">
                              <span className="font-display text-title-m leading-none font-bold stretch-wide touch:text-heading-section">
                                {team.name}
                              </span>
                              <span className="text-body-s text-ink-muted touch:hidden">
                                {plural(tp.length, "player", "players")}
                              </span>
                            </span>
                            <span className="font-mono text-body-s text-ink-muted tabular-nums">
                              {given} of {tp.length} given
                            </span>
                          </span>
                          {segs.length > 0 && (
                            <span className="flex h-2.5 gap-0.5 touch:h-2" aria-hidden>
                              {segs.map((g) => (
                                <span
                                  key={g.key}
                                  className={cx("box-border", g.barClass)}
                                  style={{ flexGrow: g.n, flexBasis: 0 }}
                                />
                              ))}
                            </span>
                          )}
                          <span className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-body-s text-ink-muted touch:sr-only">
                            {segs.map((g) => (
                              <span key={g.key} className="inline-flex items-center gap-1.5">
                                <g.icon {...iconProps} size={13} className={g.iconClass} />
                                <span className="font-mono text-ink tabular-nums">{g.n}</span>
                                {g.label}
                              </span>
                            ))}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Consent gaps: awaiting and not requested only. Withdrawn is never chased. */}
            <section
              id="consent-gaps"
              aria-labelledby="consent-gaps-title"
              className="flex scroll-mt-[var(--wl-shell-topbar)] flex-col gap-3 touch:gap-2.5"
            >
              <SectionHead
                id="consent-gaps-title"
                title="Consent gaps to chase"
                link={gaps.length > 0 ? { href: "/squad", label: `All ${gaps.length}` } : undefined}
              />
              <div className="border border-line bg-panel">
                {gaps.length === 0 ? (
                  <p className="px-4 py-3.5 text-ink-muted">No consent gaps to chase.</p>
                ) : (
                  <ul role="list">
                    {gaps.slice(0, 5).map((p) => (
                      <GapRow key={p.id} player={p} />
                    ))}
                  </ul>
                )}
                {withdrawn > 0 && (
                  <p className="px-4 py-3 text-body-s text-ink-muted">
                    Withdrawn consent is never chased.{" "}
                    {withdrawn === 1
                      ? "1 player has withdrawn."
                      : `${withdrawn} players have withdrawn.`}
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}

function GapRow({ player: p }: { player: PlayerRow }): ReactNode {
  const awaiting = consentBadgeState(p.consentState) === "awaiting";
  const meta = [p.team?.name, p.position].filter(Boolean).join(" · ");
  return (
    <li className="grid min-h-13 grid-cols-[32px_minmax(0,1fr)_auto_auto] items-center gap-2.5 border-b border-line py-2 pr-3 pl-4 touch:grid-cols-[32px_minmax(0,1fr)_auto]">
      <span
        className="grid size-8 place-items-center rounded-control bg-selected font-display text-overline leading-none font-extrabold tracking-normal stretch-wide"
        aria-hidden
      >
        {playerInitials(p)}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <Link
          href={`/squad/players/${p.id}`}
          className="truncate font-semibold underline-offset-3 hover:underline"
        >
          {playerName(p)}
        </Link>
        {meta && (
          <span className="font-mono text-body-s whitespace-nowrap text-ink-muted">{meta}</span>
        )}
      </span>
      <ConsentBadge state={p.consentState} size="s" className="touch:hidden" />
      <ButtonLink
        variant="secondary"
        size="s"
        className="touch:h-control-l"
        icon={awaiting ? Mail : Plus}
        href={`/squad/players/${p.id}`}
      >
        {awaiting ? "Remind" : "Add guardian"}
        <span className="sr-only"> for {playerName(p)}</span>
      </ButtonLink>
    </li>
  );
}
