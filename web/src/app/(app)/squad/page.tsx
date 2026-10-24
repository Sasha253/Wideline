import { Plus, Upload, Users } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/states/EmptyState";
import { DataTable, Missing, type DataColumn } from "@/components/templates/DataTable";
import { ListPage } from "@/components/templates/ListPage";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ConsentBadge } from "@/components/ui/ConsentBadge";
import { initials } from "@/components/ui/PlayerCard";
import { ClubStatusChip } from "@/components/ui/StatusChip";
import {
  FOOT_LABELS,
  FOOT_PHRASES,
  formatAge,
  formatDate,
  playerName,
  teamLabel,
} from "@/lib/labels";
import { positionLabel } from "@/lib/squad-fields";
import { CLUB_ROLES, requirePageRole } from "@/server/auth/session";
import { requireSquadOrgPage } from "@/server/squad/access";
import { countPlayers, listPlayers, type PlayerRow } from "@/server/squad/players";
import { listTeams } from "@/server/squad/teams";
import { canEditSquad, metaText } from "./shared";

export const metadata = { title: "Squad" };

type Status = "current" | "departed";

function href(teamId: string | null, status: Status) {
  const params = new URLSearchParams();
  if (teamId) params.set("team", teamId);
  if (status === "departed") params.set("status", "departed");
  const q = params.toString();
  return q ? `/squad?${q}` : "/squad";
}

function NameLink({ p }: { p: PlayerRow }) {
  const named = !p.isPlaceholder;
  return (
    <Link
      href={`/squad/players/${p.id}`}
      className={
        named ? "body-strong text-pitch underline break-words" : "body text-ink-muted underline"
      }
    >
      {playerName(p)}
    </Link>
  );
}

const orMissing = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? <Missing /> : v;

/** CONS01: the consent badge for named players; placeholders never hold consent (C05). */
function ConsentCell({ p }: { p: PlayerRow }) {
  return p.isPlaceholder ? <Missing /> : <ConsentBadge state={p.consentState} />;
}

/**
 * The squad list (SQUAD02, SQUAD09; docs/build/design/C04.md, Surfaces 1 and 2):
 * own teams' players, Current or Departed, filtered by team with query params so
 * it works without JavaScript. Opposition placeholders never appear here.
 */
export default async function SquadPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; status?: string }>;
}) {
  const ctx = requireSquadOrgPage(await requirePageRole(CLUB_ROLES));
  const params = await searchParams;
  const admin = canEditSquad(ctx.roles);
  const { own } = await listTeams(ctx);
  const team = own.find((t) => t.id === params.team) ?? null;
  const teamId = team?.id ?? null;
  const status: Status = params.status === "departed" ? "departed" : "current";
  const org = ctx.organisationName;
  const teamQuery = teamId ? `?team=${teamId}` : "";

  const teamsLink = (
    <ButtonLink variant="ghost" icon={Users} href="/squad/teams">
      Teams
    </ButtonLink>
  );

  if (own.length === 0) {
    return (
      <ListPage
        header={{ title: "Squad", intro: `Players in ${org}.`, actions: teamsLink }}
        isEmpty
        empty={
          admin ? (
            <EmptyState
              title="No teams yet"
              body="Add your first team, such as U15 Boys for the 2026 season. Then add players one by one or import them from a CSV file."
              action={
                <ButtonLink variant="primary" href="/squad/teams/new">
                  Add team
                </ButtonLink>
              }
            />
          ) : (
            <EmptyState
              title="No teams yet"
              body={`An owner or admin of ${org} adds teams and players.`}
            />
          )
        }
      />
    );
  }

  const [counts, players] = await Promise.all([
    countPlayers(ctx, { teamId }),
    listPlayers(ctx, { teamId, status }),
  ]);
  const showTeam =
    status === "departed" || (!teamId && (own.length > 1 || players.some((p) => !p.team)));
  const label = team ? teamLabel(team) : null;

  const actions = (
    <>
      {admin && (
        <>
          <ButtonLink variant="primary" icon={Plus} href={`/squad/players/new${teamQuery}`}>
            Add player
          </ButtonLink>
          <ButtonLink variant="secondary" icon={Upload} href={`/squad/import${teamQuery}`}>
            Import from CSV
          </ButtonLink>
        </>
      )}
      {teamsLink}
    </>
  );

  const toolbar =
    own.length >= 2 ? (
      <form method="get" action="/squad" className="wl-inline-form w-full max-w-xl">
        <div className="wl-field">
          <label htmlFor="squad-team" className="label">
            Team
          </label>
          <select id="squad-team" name="team" className="wl-input" defaultValue={teamId ?? ""}>
            <option value="">All teams</option>
            {own.map((t) => (
              <option key={t.id} value={t.id}>
                {teamLabel(t)}
              </option>
            ))}
          </select>
        </div>
        {status === "departed" && <input type="hidden" name="status" value="departed" />}
        <Button type="submit" variant="secondary" block className="justify-center">
          Show
        </Button>
      </form>
    ) : undefined;

  const tabs = (
    <nav aria-label="Player status" className="wl-tabs">
      {(["current", "departed"] as const).map((s) => (
        <Link
          key={s}
          href={href(teamId, s)}
          className="body-strong"
          aria-current={status === s ? "page" : undefined}
        >
          {s === "current" ? "Current" : "Departed"}{" "}
          <span className="data">{s === "current" ? counts.current : counts.departed}</span>{" "}
          <span className="sr-only">players</span>
        </Link>
      ))}
    </nav>
  );

  let content;
  if (players.length === 0) {
    content =
      status === "departed" ? (
        <EmptyState
          art={false}
          title={label ? `No departed players in ${label}` : "No departed players"}
          body="Players you mark as departed are listed here. Their records stay."
        />
      ) : admin ? (
        <EmptyState
          title={label ? `No players in ${label} yet` : "No players yet"}
          body="Add players one by one, or import your whole squad from a CSV file."
        />
      ) : (
        <EmptyState title="No players yet" body={`An owner or admin of ${org} adds the squad.`} />
      );
  } else if (status === "current") {
    const columns: DataColumn[] = [
      { id: "no", header: "No.", numeric: true },
      { id: "name", header: "Name" },
      { id: "consent", header: "Consent" },
      { id: "position", header: "Position" },
      { id: "foot", header: "Foot" },
      { id: "age", header: "Age", numeric: true },
      { id: "height", header: "Height (cm)", numeric: true },
      ...(showTeam ? [{ id: "team", header: "Team" }] : []),
    ];
    content = (
      <DataTable
        caption={
          label
            ? `Current players in ${label}, by shirt number`
            : "Current players, by team and shirt number"
        }
        columns={columns}
        rows={players.map((p) => ({
          id: p.id,
          cells: [
            orMissing(p.squadNumber),
            <NameLink key="name" p={p} />,
            <ConsentCell key="consent" p={p} />,
            orMissing(positionLabel(p.position)),
            orMissing(p.preferredFoot && FOOT_LABELS[p.preferredFoot]),
            orMissing(formatAge(p.dateOfBirth)),
            orMissing(p.heightCm),
            ...(showTeam
              ? [
                  <span key="team" className="break-words">
                    {orMissing(p.team && teamLabel(p.team))}
                  </span>,
                ]
              : []),
          ],
        }))}
        cards={players.map((p) => (
          <PlayerCardRow key={p.id} p={p} showTeam={showTeam} />
        ))}
      />
    );
  } else {
    content = (
      <DataTable
        caption={
          label ? `Departed players in ${label}, by date left` : "Departed players, by date left"
        }
        columns={[
          { id: "name", header: "Name" },
          { id: "consent", header: "Consent" },
          { id: "position", header: "Position" },
          { id: "age", header: "Age", numeric: true },
          { id: "team", header: "Team" },
          { id: "left", header: "Left on" },
        ]}
        rows={players.map((p) => ({
          id: p.id,
          cells: [
            <span key="name" className="wl-row">
              <NameLink p={p} />
              <ClubStatusChip status={p.clubStatus} />
            </span>,
            <ConsentCell key="consent" p={p} />,
            orMissing(positionLabel(p.position)),
            orMissing(formatAge(p.dateOfBirth)),
            <span key="team" className="break-words">
              {orMissing(p.team && teamLabel(p.team))}
            </span>,
            p.departedAt ? (
              <span key="left" className="data">
                {formatDate(p.departedAt)}
              </span>
            ) : (
              <Missing key="left" />
            ),
          ],
        }))}
        cards={players.map((p) => (
          <PlayerCardRow key={p.id} p={p} showTeam />
        ))}
      />
    );
  }

  return (
    <ListPage
      header={{
        title: "Squad",
        intro: label ? `Players in ${label}.` : `Players in ${org}.`,
        actions,
      }}
      toolbar={toolbar}
    >
      {tabs}
      <div className="mt-6">{content}</div>
    </ListPage>
  );
}

/** The phone card: the PlayerCard layout without stats or menu. */
function PlayerCardRow({ p, showTeam }: { p: PlayerRow; showTeam: boolean }) {
  const departed = p.clubStatus === "departed";
  const age = formatAge(p.dateOfBirth);
  // A non-breaking space keeps each number with its label or unit on narrow cards.
  const meta = metaText([
    !departed && p.squadNumber !== null && `No.\u00a0${p.squadNumber}`,
    positionLabel(p.position),
    p.preferredFoot && FOOT_PHRASES[p.preferredFoot],
    age !== null && `Age\u00a0${age}`,
    p.heightCm !== null && `${p.heightCm}\u00a0cm`,
    (showTeam || departed) && p.team && teamLabel(p.team),
  ]);
  return (
    <li className="wl-card flex items-start gap-3">
      <span className="wl-avatar" aria-hidden="true">
        {p.isPlaceholder ? (p.squadNumber ?? "") : initials(playerName(p))}
      </span>
      <div className="min-w-0 flex-1">
        <Link
          href={`/squad/players/${p.id}`}
          className={
            p.isPlaceholder
              ? "wl-link-row body text-ink-muted underline"
              : "wl-link-row body-strong text-pitch underline break-words"
          }
        >
          {playerName(p)}
        </Link>
        {meta && <p className="caption text-ink-muted">{meta}</p>}
        {(!p.isPlaceholder || departed) && (
          <div className="wl-row mt-2">
            {!p.isPlaceholder && <ConsentBadge state={p.consentState} />}
            {departed && <ClubStatusChip status={p.clubStatus} />}
            {departed && p.departedAt && (
              <span className="caption text-ink-muted">Left on {formatDate(p.departedAt)}</span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
