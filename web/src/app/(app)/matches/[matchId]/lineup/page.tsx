import Link from "next/link";
import { notFound } from "next/navigation";
import { Banner } from "@/components/forms";
import { EmptyState } from "@/components/states/EmptyState";
import { PageHeader } from "@/components/templates/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { ClubStatusChip } from "@/components/ui/StatusChip";
import { TeamMarker } from "@/components/ui/TeamMarker";
import { fixtureText, formatDate, playerName, teamLabel } from "@/lib/labels";
import { maxSubstitutionMinute } from "@/lib/match-clock";
import { positionLabel } from "@/lib/squad-fields";
import { CLUB_ROLES, requirePageRole } from "@/server/auth/session";
import { isLocked, requireSquadOrgPage } from "@/server/matches/access";
import { lockedMessage, MatchError } from "@/server/matches/errors";
import {
  getLineups,
  pickerFor,
  rowLabel,
  type LineupRow,
  type MatchLineups,
  type SideLineup,
} from "@/server/matches/lineups";
import { LineupEditor, type EditorRow, type Selection } from "./LineupEditor";
import { OppositionNumbers } from "./OppositionNumbers";
import { Substitutions } from "./Substitutions";

export const metadata = { title: "Lineups" };

type Props = {
  params: Promise<{ matchId: string }>;
  searchParams: Promise<{ side?: string }>;
};

async function load(ctx: Parameters<typeof getLineups>[0], matchId: string) {
  try {
    return await getLineups(ctx, matchId);
  } catch (err) {
    if (err instanceof MatchError && err.code === "not_found") return null;
    throw err;
  }
}

const ORDER: Record<Selection, number> = { starter: 0, substitute: 1, none: 2 };

/** Starters, substitutes, then the rest; inside each, number ascending (blanks last), then last name. */
function sortRows(rows: (EditorRow & { lastName: string })[]) {
  return rows.sort(
    (a, b) =>
      ORDER[a.selection] - ORDER[b.selection] ||
      (a.shirtNumber ?? Infinity) - (b.shirtNumber ?? Infinity) ||
      a.lastName.localeCompare(b.lastName, "en-ZA"),
  );
}

/** The side a coach opens first: their own team, home when both are. */
function defaultSide(l: MatchLineups): "home" | "away" {
  return l.match.homeTeam.isOpposition && !l.match.awayTeam.isOpposition ? "away" : "home";
}

/**
 * Lineups and substitutions (SQUAD04 to SQUAD06, SQUAD09;
 * docs/build/design/C06.md, Surface 4). One side at a time, chosen with
 * ?side=. Locked once the match is in review.
 */
export default async function LineupPage({ params, searchParams }: Props) {
  const ctx = requireSquadOrgPage(await requirePageRole(CLUB_ROLES));
  const { matchId } = await params;
  const lineups = await load(ctx, matchId);
  if (!lineups) notFound();
  const query = await searchParams;
  const sideKey =
    query.side === "home" || query.side === "away" ? query.side : defaultSide(lineups);
  const side: SideLineup = lineups[sideKey];
  const { match } = lineups;
  const locked = isLocked(match.status);
  const team = side.team;
  const label = teamLabel(team);

  const picker = await pickerFor(ctx, team.id);
  const existing = new Map(side.rows.map((r) => [r.playerId, r]));
  const departed = side.rows.filter((r) => r.player.clubStatus === "departed");
  const editorRows = sortRows(
    picker.map((p) => {
      const row = existing.get(p.id);
      return {
        playerId: p.id,
        name: playerName(p),
        squadNumber: p.squadNumber,
        isPlaceholder: p.isPlaceholder,
        selection: row ? (row.isStarter ? "starter" : "substitute") : "none",
        shirtNumber: row?.shirtNumber ?? p.squadNumber,
        position: row ? row.position : p.position,
        lastName: p.lastName ?? "",
      };
    }),
  );

  const onPitch = side.rows.filter((r) => r.startedAt !== null && r.endedAt === null);
  const unused = side.rows.filter((r) => !r.isStarter && r.startedAt === null);
  const byNumber = (a: LineupRow, b: LineupRow) => a.shirtNumber - b.shirtNumber;

  let players;
  if (picker.length === 0 && !team.isOpposition) {
    players = (
      <div className="mt-4">
        <EmptyState
          art={false}
          title={`No current players in ${label}`}
          body="Add players to the squad first."
          action={
            <ButtonLink variant="secondary" href={`/squad/players/new?team=${team.id}`}>
              Add player
            </ButtonLink>
          }
        />
      </div>
    );
  } else if (picker.length === 0) {
    players = (
      <p className="body mt-4">
        No shirt numbers yet for {label}. Add the numbers their players wore.
      </p>
    );
  } else {
    players = (
      <LineupEditor
        key={team.id}
        matchId={match.id}
        teamId={team.id}
        rows={editorRows}
        locked={locked}
      />
    );
  }

  return (
    <>
      <PageHeader
        back={{ href: `/matches/${match.id}`, label: "Match" }}
        title="Lineups"
        intro={`${fixtureText(match)} · ${formatDate(match.playedAt)}`}
      />
      <nav className="wl-tabs mt-6" aria-label="Side">
        {(["home", "away"] as const).map((s) => (
          <Link
            key={s}
            href={`/matches/${match.id}/lineup?side=${s}`}
            className="body-strong"
            aria-current={s === sideKey ? "page" : undefined}
          >
            <TeamMarker side={s} name={lineups[s].team.name} truncate />
            <span className="data text-ink-muted">{lineups[s].rows.length}</span>
            <span className="sr-only"> players</span>
          </Link>
        ))}
      </nav>
      {locked && (
        <div className="mt-6">
          <Banner tone="warn">
            {lockedMessage("Lineups", match.status as "in_review" | "published")}
          </Banner>
        </div>
      )}
      <section aria-labelledby="players-heading" className="mt-6">
        <h2 id="players-heading" tabIndex={-1} className="heading-2">
          Players
        </h2>
        <p className="body mt-2 max-w-prose text-ink-muted">
          Choose who started and who was on the bench. Shirt numbers can differ from squad numbers.
        </p>
        {players}
        {departed.length > 0 && (
          <div className="max-w-4xl">
            <h3 className="body-strong mt-6">Players who have left the club</h3>
            <ul className="wl-lineup mt-2" role="list">
              {departed.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-3 border-t border-line py-3"
                >
                  <span className="body-strong">{playerName(r.player)}</span>
                  <ClubStatusChip status={r.player.clubStatus} />
                  <span className="body">{r.isStarter ? "Starter" : "Substitute"}</span>
                  <span className="data">{r.shirtNumber}</span>
                  {r.position && <span className="body">{positionLabel(r.position)}</span>}
                </li>
              ))}
            </ul>
            <p className="caption mt-2 text-ink-muted">
              They stay in this lineup. You cannot change their rows.
            </p>
          </div>
        )}
        {team.isOpposition && !locked && <OppositionNumbers matchId={match.id} teamId={team.id} />}
      </section>
      <Substitutions
        key={side.team.id}
        matchId={match.id}
        teamId={team.id}
        maxMinute={maxSubstitutionMinute(match.halfLengthMinutes)}
        items={side.substitutions.map((s) => ({
          offLineupId: s.off.id,
          minute: s.minute,
          offLabel: rowLabel(s.off),
          onLabel: s.on ? rowLabel(s.on) : null,
        }))}
        onPitch={onPitch.sort(byNumber).map((r) => ({ id: r.id, label: rowLabel(r) }))}
        unused={unused.sort(byNumber).map((r) => ({ id: r.id, label: rowLabel(r) }))}
        hasLineup={side.rows.length > 0}
        locked={locked}
      />
    </>
  );
}
