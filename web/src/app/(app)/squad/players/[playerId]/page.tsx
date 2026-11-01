import { notFound } from "next/navigation";
import { cache } from "react";
import { Banner } from "@/components/forms";
import { DetailPage, type DetailSection } from "@/components/templates/DetailPage";
import { ConsentBadge } from "@/components/ui/ConsentBadge";
import { MiniPitch, type PitchSpot } from "@/components/ui/MiniPitch";
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
import { CONSENT_STATE_LABELS, isGranted, isMinorOn } from "@/lib/consent-rules";
import {
  canUndoDeparture,
  departureUndoDeadline,
  positionLabel,
  todayIso,
} from "@/lib/squad-fields";
import {
  CLUB_ROLES,
  CONSENT_ADMIN_ROLES,
  requirePageRole,
  type AuthContext,
} from "@/server/auth/session";
import { consentHistory } from "@/server/consent/records";
import { openConsentRequest } from "@/server/consent/requests";
import { requireSquadOrgPage } from "@/server/squad/access";
import { getPlayer, PlayerError, type PlayerRow } from "@/server/squad/players";
import { listTeams } from "@/server/squad/teams";
import { FocusHeadingOnMount } from "../../FocusOnMount";
import { canEditSquad, Facts, metaText } from "../../shared";
import { PlayerForm } from "../PlayerForm";
import { ConsentActions } from "./ConsentActions";
import { ConsentHistory, ConsentSummary } from "./ConsentSection";
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
 * Where each recorded position sits on the mini pitch, in metres (attacking left to
 * right, y from the top touchline, so the right flank is low). The club's recorded
 * position, not tracking data.
 */
const PITCH_SPOTS: Record<string, Omit<PitchSpot, "label">> = {
  GK: { x: 5, y: 34 },
  RB: { x: 24, y: 58 },
  CB: { x: 20, y: 34 },
  LB: { x: 24, y: 10 },
  RWB: { x: 38, y: 60 },
  LWB: { x: 38, y: 8 },
  DM: { x: 38, y: 34 },
  CM: { x: 50, y: 34 },
  AM: { x: 66, y: 34 },
  RM: { x: 58, y: 58 },
  LM: { x: 58, y: 10 },
  RW: { x: 80, y: 58 },
  LW: { x: 80, y: 10 },
  ST: { x: 90, y: 34 },
};

/**
 * One player (SQUAD02, SQUAD09; docs/build/design/C04.md, Surface 5). Owners
 * and admins edit a current player and can mark them departed, and undo a
 * departure for DEPARTURE_UNDO_DAYS. Coaches, and everyone for a departed
 * player or a placeholder, see the facts only.
 *
 * Named players also get Consent (first, after the hero) and Consent history
 * (after Details), and a ConsentBadge in the hero (CONS01 to CONS03;
 * docs/build/design/C05.md, Surfaces 4 to 6). Placeholders get neither.
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

  // Floodlight hero (Screens B "Player profile"): position, age and shirt number in the
  // overline, the name in display-xl, then the team line. Departed players keep their last
  // team but no current number.
  const heroNumber = departed ? null : player.squadNumber;
  const eyebrow =
    metaText([
      position,
      age !== null && `Age ${age}`,
      heroNumber !== null && `No. ${heroNumber}`,
    ]) || undefined;

  const meta = metaText([
    team ? (departed ? `Last team ${team}` : team) : "No team",
    player.preferredFoot && FOOT_PHRASES[player.preferredFoot],
    height,
  ]);
  const spot = player.position ? PITCH_SPOTS[player.position] : undefined;

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
            <p className="m-0 max-w-prose text-ink-muted">
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
            <p className="m-0 max-w-prose text-ink-muted">
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

  if (!player.isPlaceholder) {
    const [history, openLink] = await Promise.all([
      consentHistory(ctx, player.id),
      openConsentRequest(ctx, player.id),
    ]);
    const consentAdmin = ctx.roles.some((r) => CONSENT_ADMIN_ROLES.includes(r));
    const granted = isGranted(player.consentState);
    const consent: DetailSection = {
      id: "consent",
      title: "Consent",
      content: (
        <ConsentActions
          playerId={player.id}
          name={name}
          firstName={firstName}
          admin={consentAdmin}
          active={!departed}
          minor={isMinorOn(player.dateOfBirth)}
          granted={granted}
          changeLabel={granted ? "Change consent" : "Record consent"}
          openLink={
            openLink && {
              createdOn: formatDate(openLink.createdAt),
              until: formatDate(openLink.expiresAt),
              emailMasked: openLink.emailMasked,
            }
          }
          initialBanner={
            done === "consent"
              ? `Consent saved. ${firstName}'s consent is now ${CONSENT_STATE_LABELS[player.consentState]}.`
              : null
          }
          notes={
            departed && consentAdmin ? (
              <p className="m-0 mt-2 text-body-s text-ink-muted">
                {firstName} has left the club. You can withdraw consent, but not record new consent.
              </p>
            ) : undefined
          }
        >
          <ConsentSummary
            newest={history[0] ?? null}
            state={player.consentState}
            name={name}
            firstName={firstName}
            clubName={ctx.organisationName}
            noDateOfBirth={!player.dateOfBirth}
            openUntil={openLink?.expiresAt ?? null}
          />
        </ConsentActions>
      ),
    };
    const historySection: DetailSection = {
      id: "consent-history",
      title: "Consent history",
      content: <ConsentHistory rows={history} name={name} />,
    };
    const details = sections.findIndex((s) => s.id === "details");
    sections.splice(details + 1, 0, historySection);
    sections.unshift(consent);
  }

  const justDeparted = done === "departed" && departed;
  const justRestored = done === "restored" && !departed;

  return (
    <>
      {(justDeparted || justRestored) && <FocusHeadingOnMount />}
      <DetailPage
        back={{ href: back, label: "Squad" }}
        media={
          // No photos: the shirt number, outlined, or initials when there is no number.
          heroNumber !== null ? (
            <span
              aria-hidden="true"
              className="block font-display text-display-xl leading-[0.78] font-extrabold tracking-[-0.04em] text-selected tabular-nums stretch-wide [-webkit-text-stroke:1px_var(--wl-color-ink-muted)] tablet:text-[7.5rem] tablet:[-webkit-text-stroke:1.5px_var(--wl-color-ink-muted)]"
            >
              {String(heroNumber).padStart(2, "0")}
            </span>
          ) : (
            <span className="wl-avatar" aria-hidden="true">
              {player.isPlaceholder ? "" : initials(name)}
            </span>
          )
        }
        eyebrow={eyebrow}
        title={name}
        meta={meta || undefined}
        actions={
          spot ? (
            <MiniPitch usual={{ ...spot, label: player.position ?? "" }} className="w-32" />
          ) : undefined
        }
        badges={
          player.isPlaceholder ? undefined : (
            <>
              <ConsentBadge state={player.consentState} />
              {departed && <ClubStatusChip status={player.clubStatus} />}
            </>
          )
        }
        notice={
          <>
            <div aria-live="polite" className="mt-6 empty:mt-0">
              {justDeparted && (
                <Banner tone="ok">{name} is marked as departed. Their records are kept.</Banner>
              )}
              {justRestored && <Banner tone="ok">{name} is back in the squad.</Banner>}
            </div>
            {note && <p className="m-0 mt-6 max-w-prose text-ink-muted">{note}</p>}
          </>
        }
        sections={sections}
      />
    </>
  );
}
