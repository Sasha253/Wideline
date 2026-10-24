import { notFound } from "next/navigation";
import { cache } from "react";
import { Banner } from "@/components/forms";
import { DetailPage, type DetailSection } from "@/components/templates/DetailPage";
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
import {
  canUndoDeparture,
  departureUndoDeadline,
  positionLabel,
  todayIso,
} from "@/lib/squad-fields";
import { CLUB_ROLES, requirePageRole, type AuthContext } from "@/server/auth/session";
import { requireSquadOrgPage } from "@/server/squad/access";
import { getPlayer, PlayerError, type PlayerRow } from "@/server/squad/players";
import { listTeams } from "@/server/squad/teams";
import { FocusHeadingOnMount } from "../../FocusOnMount";
import { canEditSquad, Facts, metaText } from "../../shared";
import { PlayerForm } from "../PlayerForm";
import { DepartPlayer } from "./DepartPlayer";
import { UndoDeparture } from "./UndoDeparture";

type Props = {
  params: Promise<{ playerId: string }>;
  searchParams?: Promise<{ done?: string }>;
};

// One read per request, shared by generateMetadata and the page. Opposition
// placeholders have no page: they exist only for match lineups.
const loadPlayer = cache(async (ctx: AuthContext, playerId: string): Promise<PlayerRow | null> => {
  try {
    const player = await getPlayer(ctx, playerId);
    return player.team?.isOpposition ? null : player;
  } catch (err) {
    if (err instanceof PlayerError && err.code === "not_found") return null;
    throw err;
  }
});

export async function generateMetadata({ params }: Props) {
  const ctx = requireSquadOrgPage(await requirePageRole(CLUB_ROLES));
  const player = await loadPlayer(ctx, (await params).playerId);
  return { title: player ? playerName(player) : "Player" };
}

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/**
 * One player (SQUAD02, SQUAD09; docs/build/design/C04.md, Surface 5). Owners
 * and admins edit a current player and can mark them departed, and undo a
 * departure for DEPARTURE_UNDO_DAYS. Coaches, and everyone for a departed
 * player or a placeholder, see the facts only.
 */
export default async function PlayerPage({ params, searchParams }: Props) {
  const ctx = requireSquadOrgPage(await requirePageRole(CLUB_ROLES));
  const player = await loadPlayer(ctx, (await params).playerId);
  if (!player) notFound();
  const done = (await searchParams)?.done;
  const admin = canEditSquad(ctx.roles);
  const name = playerName(player);
  const firstName = player.firstName ?? name;
  const departed = player.clubStatus === "departed";
  const team = player.team ? teamLabel(player.team) : null;
  const age = formatAge(player.dateOfBirth);
  const height = player.heightCm !== null ? `${player.heightCm} cm` : null;
  const foot = player.preferredFoot ? FOOT_LABELS[player.preferredFoot] : null;
  const position = positionLabel(player.position);

  const back = player.teamId
    ? departed
      ? `/squad?status=departed&team=${player.teamId}`
      : `/squad?team=${player.teamId}`
    : departed
      ? "/squad?status=departed"
      : "/squad";

  let eyebrow: string;
  if (departed) eyebrow = team ?? "No team";
  else if (!team) eyebrow = "No team";
  else eyebrow = player.squadNumber !== null ? `No. ${player.squadNumber} · ${team}` : team;

  const meta = metaText([
    position,
    player.preferredFoot && FOOT_PHRASES[player.preferredFoot],
    age !== null && `Age ${age}`,
    height,
  ]);

  const sections: DetailSection[] = [];
  let note: string | null = null;

  if (player.isPlaceholder) {
    note = "This is an unnamed placeholder from a match lineup. It has no name or date of birth.";
    sections.push({
      id: "details",
      title: "Details",
      content: (
        <div className="wl-card max-w-3xl">
          <Facts
            items={[
              ["Team", team],
              ["Shirt number", player.squadNumber],
              ["Position", position],
            ]}
          />
        </div>
      ),
    });
  } else if (departed) {
    const undoOpen = admin && canUndoDeparture(player.departedAt);
    note = `${firstName} left the club on ${player.departedAt ? formatDate(player.departedAt) : "an unknown date"}. Their matches, stats and consent records are kept. ${undoOpen ? "To change their details, undo the departure first." : "The club can no longer edit their details."}`;
    sections.push({
      id: "details",
      title: "Details",
      content: (
        <div className="wl-card max-w-3xl">
          <Facts
            items={[
              ["Last team", team],
              ["Last squad number", player.squadNumber],
              ["Date of birth", player.dateOfBirth && formatDate(player.dateOfBirth)],
              ["Position", position],
              ["Preferred foot", foot],
              ["Height", height],
              ["Left on", player.departedAt && formatDate(player.departedAt)],
            ]}
          />
        </div>
      ),
    });
    if (undoOpen && player.departedAt) {
      sections.push({
        id: "undo",
        title: "Undo departure",
        content: (
          <>
            <p className="body max-w-prose text-ink-muted">
              Marked as departed by mistake? Undo it to put {firstName} back in the squad with the
              same details.
            </p>
            <div className="mt-4">
              <UndoDeparture
                playerId={player.id}
                until={formatDate(departureUndoDeadline(player.departedAt))}
              />
            </div>
          </>
        ),
      });
    }
  } else if (admin) {
    const { own } = await listTeams(ctx);
    sections.push(
      {
        id: "details",
        title: "Details",
        content: (
          <div className="wl-card max-w-3xl">
            <PlayerForm
              mode="edit"
              playerId={player.id}
              initial={{
                firstName: player.firstName ?? "",
                lastName: player.lastName ?? "",
                dateOfBirth: isoDate(player.dateOfBirth),
                position: player.position ?? "",
                preferredFoot: player.preferredFoot ?? "",
                heightCm: player.heightCm !== null ? String(player.heightCm) : "",
                squadNumber: player.squadNumber !== null ? String(player.squadNumber) : "",
                teamId: player.teamId ?? "",
              }}
              teams={own.map((t) => ({ id: t.id, label: teamLabel(t) }))}
              today={todayIso()}
            />
          </div>
        ),
      },
      {
        id: "leaving",
        title: "Leaving the club",
        content: (
          <>
            <p className="body max-w-prose text-ink-muted">
              When a player leaves, mark them as departed. They leave squad lists, lineup pickers
              and dashboards. Nothing is deleted.
            </p>
            <div className="mt-4">
              <DepartPlayer playerId={player.id} name={name} firstName={firstName} />
            </div>
          </>
        ),
      },
    );
  } else {
    sections.push({
      id: "details",
      title: "Details",
      content: (
        <div className="wl-card max-w-3xl">
          <Facts
            items={[
              ["Team", team],
              ["Squad number", player.squadNumber],
              ["Date of birth", player.dateOfBirth && formatDate(player.dateOfBirth)],
              ["Position", position],
              ["Preferred foot", foot],
              ["Height", height],
            ]}
          />
        </div>
      ),
    });
  }

  const justDeparted = done === "departed" && departed;
  const justRestored = done === "restored" && !departed;

  return (
    <>
      {(justDeparted || justRestored) && <FocusHeadingOnMount />}
      <DetailPage
        back={{ href: back, label: "Squad" }}
        media={
          <span className="wl-avatar" aria-hidden="true">
            {player.isPlaceholder ? (player.squadNumber ?? "") : initials(name)}
          </span>
        }
        eyebrow={eyebrow}
        title={name}
        meta={meta || undefined}
        badges={departed ? <ClubStatusChip status={player.clubStatus} /> : undefined}
        notice={
          <>
            <div aria-live="polite" className="mt-6 empty:mt-0">
              {justDeparted && (
                <Banner tone="ok">{name} is marked as departed. Their records are kept.</Banner>
              )}
              {justRestored && <Banner tone="ok">{name} is back in the squad.</Banner>}
            </div>
            {note && <p className="body mt-6 max-w-prose text-ink-muted">{note}</p>}
          </>
        }
        sections={sections}
      />
    </>
  );
}
