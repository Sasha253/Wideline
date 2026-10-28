import { notFound } from "next/navigation";
import { cache, Fragment } from "react";
import { ConsentWording } from "@/components/consent/ConsentWording";
import { Missing } from "@/components/templates/DataTable";
import { PageHeader } from "@/components/templates/PageHeader";
import { ThemeScope } from "@/components/ui/theme";
import { GUARDIAN_RELATIONSHIPS, isMinorOn, RELATIONSHIP_LABELS } from "@/lib/consent-rules";
import { formatDate, playerName, teamLabel } from "@/lib/labels";
import { CLUB_ROLES, requirePageRole, type AuthContext } from "@/server/auth/session";
import { CONSENT_WORDING_VERSION } from "@/server/consent/wording";
import { requireSquadOrgPage } from "@/server/squad/access";
import { getPlayer, PlayerError } from "@/server/squad/players";
import { PrintButton } from "./PrintButton";
import { Logo } from "@/components/ui/Logo";

type Props = { params: Promise<{ playerId: string }> };

const load = cache(async (ctx: AuthContext, playerId: string) => {
  try {
    const p = await getPlayer(ctx, playerId);
    return p.isPlaceholder || p.team?.isOpposition ? null : p;
  } catch (err) {
    if (err instanceof PlayerError && err.code === "not_found") return null;
    throw err;
  }
});

export async function generateMetadata({ params }: Props) {
  const ctx = requireSquadOrgPage(await requirePageRole(CLUB_ROLES));
  const player = await load(ctx, (await params).playerId);
  return { title: player ? `Paper consent form for ${playerName(player)}` : "Paper consent form" };
}

function Box() {
  return <span className="wl-paper__box" aria-hidden="true" />;
}

function Option({ children }: { children: string }) {
  return (
    <p className="wl-paper__option body-lg">
      <Box />
      {children}
    </p>
  );
}

function Line({ label }: { label: string }) {
  return (
    <div>
      <p className="label">{label}</p>
      <span className="wl-paper__line" />
    </div>
  );
}

/**
 * The printable paper consent form (CONS02, CONS04, NFR09;
 * docs/build/design/C05.md, Surface 3): the current wording and its version,
 * tick boxes for both questions and lines for who answers. Coaches may print
 * it. The sheet is forced light, because it previews paper.
 */
export default async function PrintConsentPage({ params }: Props) {
  const ctx = requireSquadOrgPage(await requirePageRole(CLUB_ROLES));
  const player = await load(ctx, (await params).playerId);
  if (!player) notFound();
  const name = playerName(player);
  const first = player.firstName ?? name;
  const club = ctx.organisationName;
  const minor = isMinorOn(player.dateOfBirth);
  const departed = player.clubStatus === "departed";
  const team = player.team ? teamLabel(player.team) : null;
  const titleId = `paper-${player.id}`;

  return (
    <>
      <div className="wl-print-hide">
        <PageHeader
          back={{ href: `/squad/players/${player.id}`, label: name }}
          title="Paper consent form"
          intro={`Print this form and give it to ${minor ? `${first}'s parent or guardian` : first}. When it comes back signed, record the answer on Wideline.`}
          actions={<PrintButton />}
        />
        <noscript>
          <p className="caption mt-2">Use your browser&apos;s print command.</p>
        </noscript>
        {departed && (
          <p className="body mt-4 text-ink-muted">
            {first} has left the club. Use this form only to record a withdrawal.
          </p>
        )}
      </div>

      <ThemeScope theme="light" className="mt-8">
        <article className="wl-paper" aria-labelledby={titleId}>
          <p className="heading-2">
            <Logo />
          </p>
          <p className="eyebrow text-ink-muted">{club}</p>
          <h1 id={titleId} className="heading-1 mt-4 break-words">
            Consent for {name}
          </h1>
          <dl className="wl-facts mt-4">
            {(
              [
                ["Player", name],
                ["Date of birth", player.dateOfBirth ? formatDate(player.dateOfBirth) : null],
                ...(team ? [["Team", team]] : []),
              ] as [string, string | null][]
            ).map(([label, value]) => (
              <Fragment key={label}>
                <dt className="label">{label}</dt>
                <dd className="body">{value ?? <Missing />}</dd>
              </Fragment>
            ))}
          </dl>

          <section className="wl-paper__section">
            <ConsentWording
              version={CONSENT_WORDING_VERSION}
              audience={minor ? "guardian" : "player"}
              headingLevel={2}
              framed={false}
            />
          </section>

          <section className="wl-paper__section">
            <h2 className="heading-2">Your answers</h2>
            <p className="body-lg">Tick one box for each question.</p>
            <p className="body-lg body-strong mt-4">
              1. Can {club} record {first}&apos;s stats?
            </p>
            <Option>Yes, the club can record them</Option>
            <Option>No, do not record them</Option>
            <p className="body-lg body-strong mt-4">2. Can scouts see {first}&apos;s stats?</p>
            <p className="caption">Only answer this if you said yes to question 1.</p>
            <Option>Yes, scouts can see them</Option>
            <Option>No, keep them inside the club</Option>
          </section>

          <section className="wl-paper__section">
            <h2 className="heading-2">Who is answering</h2>
            <div className="mt-4 flex flex-col gap-4">
              <Line label="Your full name" />
              {minor ? (
                <>
                  <div>
                    <p className="body-lg">How are you related to {first}?</p>
                    {GUARDIAN_RELATIONSHIPS.map((r) => (
                      <Option key={r}>{RELATIONSHIP_LABELS[r]}</Option>
                    ))}
                  </div>
                  <Option>{`I am ${first}'s parent or guardian and I am 18 or over.`}</Option>
                </>
              ) : (
                <Option>I am 18 or over and I decide for myself.</Option>
              )}
              <div className="wl-paper__lines">
                <Line label="Signature" />
                <Line label="Date" />
              </div>
            </div>
          </section>

          <section className="wl-paper__section border-t border-line pt-6">
            <p className="label text-ink-muted">For the club</p>
            <div className="wl-paper__lines mt-4">
              <Line label="Recorded on Wideline by" />
              <Line label="Date recorded" />
            </div>
          </section>

          <p className="caption mt-8 text-ink-muted">
            Wording version <span className="data">{CONSENT_WORDING_VERSION}</span>
          </p>
        </article>
      </ThemeScope>
    </>
  );
}
