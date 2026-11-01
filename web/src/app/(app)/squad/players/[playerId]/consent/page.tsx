import { notFound } from "next/navigation";
import { cache } from "react";
import { ConsentWording } from "@/components/consent/ConsentWording";
import { EmptyState } from "@/components/states/EmptyState";
import { PageHeader } from "@/components/templates/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { ConsentBadge } from "@/components/ui/ConsentBadge";
import { isGranted, isMinorOn } from "@/lib/consent-rules";
import { formatDate, playerName } from "@/lib/labels";
import { todayIso } from "@/lib/squad-fields";
import {
  CLUB_ROLES,
  CONSENT_ADMIN_ROLES,
  requirePageRole,
  type AuthContext,
} from "@/server/auth/session";
import { ConsentError, consentPlayer, currentConsent } from "@/server/consent/records";
import { CONSENT_WORDING_VERSION } from "@/server/consent/wording";
import { requireSquadOrgPage } from "@/server/squad/access";
import { ConsentForm } from "./ConsentForm";

type Props = { params: Promise<{ playerId: string }> };

// Named, own-team players only; anything else is not found.
const load = cache(async (ctx: AuthContext, playerId: string) => {
  try {
    const p = await consentPlayer(ctx, playerId);
    return p.isPlaceholder || p.isOpposition ? null : p;
  } catch (err) {
    if (err instanceof ConsentError && err.code === "not_found") return null;
    throw err;
  }
});

export async function generateMetadata({ params }: Props) {
  const ctx = requireSquadOrgPage(await requirePageRole(CLUB_ROLES));
  const player = await load(ctx, (await params).playerId);
  return { title: player ? `Consent for ${playerName(player)}` : "Consent" };
}

/**
 * The club consent recording form (CONS02, NFR09, NFR10;
 * docs/build/design/C05.md, Surface 2). Coaches and departed players get a
 * note instead of the form; the action checks CONSENT_ADMIN_ROLES again.
 */
export default async function ConsentPage({ params }: Props) {
  const ctx = requireSquadOrgPage(await requirePageRole(CLUB_ROLES));
  const player = await load(ctx, (await params).playerId);
  if (!player) notFound();
  const name = playerName(player);
  const first = player.firstName ?? name;
  const admin = ctx.roles.some((r) => CONSENT_ADMIN_ROLES.includes(r));
  const departed = player.clubStatus === "departed";
  const minor = isMinorOn(player.dateOfBirth);
  const current = await currentConsent(ctx, player.id);
  const back = { href: `/squad/players/${player.id}`, label: name };

  const intro = !player.dateOfBirth
    ? `We do not have ${first}'s date of birth, so we treat ${first} as under 18. A parent or guardian decides.`
    : minor
      ? `${first} is under 18, so a parent or guardian decides. Record what they chose, and how.`
      : `${first} is 18 or over and decides for themselves. Record what they chose, and how.`;

  const header = (
    <>
      <PageHeader
        back={back}
        eyebrow="Consent"
        title={
          isGranted(player.consentState)
            ? `Change consent for ${name}`
            : `Record consent for ${name}`
        }
        intro={intro}
      />
      <p className="wl-row mt-4">
        <ConsentBadge state={player.consentState} />
        <span className="text-ink-muted">
          {current.id
            ? `Current consent, recorded ${formatDate(current.createdAt)}`
            : "No consent recorded yet"}
        </span>
      </p>
    </>
  );

  const backButton = (
    <ButtonLink variant="secondary" href={back.href}>
      Back to {first}
    </ButtonLink>
  );

  if (!admin || departed) {
    return (
      <>
        {header}
        <div className="mt-8">
          {!admin ? (
            <EmptyState
              art={false}
              title="Only owners and admins can record consent"
              body={`Ask an owner or admin of ${ctx.organisationName} to record consent for ${first}.`}
              action={backButton}
            />
          ) : (
            <EmptyState
              art={false}
              title={`${first} has left the club`}
              body={`The club cannot record new consent for a departed player. You can still withdraw consent on ${first}'s page.`}
              action={backButton}
            />
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <section aria-label={`Consent for ${name}`} className="wl-card mt-8 max-w-3xl">
        <ConsentForm
          playerId={player.id}
          firstName={first}
          name={name}
          clubName={ctx.organisationName}
          minor={minor}
          today={todayIso()}
          version={CONSENT_WORDING_VERSION}
          wording={
            <ConsentWording
              version={CONSENT_WORDING_VERSION}
              audience={minor ? "guardian" : "player"}
              headingLevel={3}
              framed={false}
            />
          }
        />
      </section>
    </>
  );
}
