import { notFound } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import { Banner } from "@/components/forms";
import { DetailPage } from "@/components/templates/DetailPage";
import { ButtonLink } from "@/components/ui/Button";
import { ClaimTimeLeft } from "@/components/ui/ExpiryBanner";
import { ClaimStatusChip } from "@/components/ui/StatusChip";
import { DEFAULT_THEME } from "@/components/ui/theme-constants";
import { getThemeChoice } from "@/components/ui/theme-server";
import type { ReviewClaimStatus, ReviewReleaseReason } from "@/generated/prisma/enums";
import { fixtureText, formatDateTime, formatMatchDate } from "@/lib/labels";
import { requireReviewerPage } from "@/server/auth/reviewer";
import { claimHlsBase } from "@/server/matches/playback";
import { ownClaim } from "@/server/review/claims";
import { IMPERSONATION_REFUSED } from "@/server/review/errors";
import { claimScope } from "@/server/review/scope";
import { claimFacts, loadWorkspace } from "@/server/review/workspace";
import { doneMessage } from "../../../matches/shared";
import { CLAIM_HOURS, RawFootageFact, ToCheckText } from "../../shared";
import { ReleaseClaim } from "./ReleaseClaim";
import { ReviewWorkspace } from "./ReviewWorkspace";

export const metadata = { title: "Claimed match" };

type Props = {
  params: Promise<{ claimId: string }>;
  searchParams: Promise<{ done?: string }>;
};

const BACK = { href: "/review", label: "Review queue" };

/** Why a claim ended (docs/build/design/C10.md, Surface 3, "Ended claim"). */
function endedReason(status: ReviewClaimStatus, reason: ReviewReleaseReason | null): string {
  if (status === "submitted") return "You marked this match as reviewed. Thank you.";
  if (status === "released") {
    switch (reason) {
      case "scout":
        return "You released this match. It went back to the queue for other scouts.";
      case "conflict":
        return "This claim was released because you added a club or player linked to this match.";
      case "admin":
        return "Wideline staff released this match.";
      default:
        return "This claim was released.";
    }
  }
  return `Your ${CLAIM_HOURS} hours ran out, so the match went back to the queue. You can claim it again if it is still waiting.`;
}

function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-1 tablet:grid-cols-[10rem_minmax(0,1fr)] tablet:gap-y-3">
      {items.map(([term, value]) => (
        <Fragment key={term}>
          <dt className="mt-2 font-mono text-overline text-ink-muted uppercase first:mt-0 tablet:mt-0 tablet:pt-0.5">
            {term}
          </dt>
          <dd className="m-0">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function SectionHead({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="m-0 font-display text-heading-section uppercase stretch-wide">
      {children}
    </h2>
  );
}

/**
 * The scout's claimed match (REVIEW01; Floodlight, Screens B "Review workspace"). The
 * workspace comes first, with its own header (Queue, the fixture as the page's h1,
 * progress, Mark as reviewed) and the expiry banner under it; then the claim's facts and
 * Release. Read through claimScope() on this request, footage only from the claim-checked
 * routes. A "Log in as" session gets it read-only (Q-064). Another scout's claim, or an
 * unknown id, is not found. An active claim past its end reads as expired (lazy expiry,
 * A-5).
 */
export default async function ClaimedMatchPage({ params, searchParams }: Props) {
  const ctx = await requireReviewerPage();
  const [{ claimId }, sp] = await Promise.all([params, searchParams]);
  const now = new Date();
  const claim = await ownClaim(ctx, claimId, now);
  if (!claim) notFound();
  const { match } = claim;

  if (claim.status !== "active") {
    const meta = [
      formatMatchDate(match.playedAt),
      match.organisationName,
      match.ageGroup,
      match.competition,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <DetailPage
        back={BACK}
        eyebrow="Your claimed match"
        title={fixtureText(match)}
        meta={meta}
        badges={<ClaimStatusChip status={claim.status} />}
        notice={
          <div className="mt-6 max-w-2xl border border-line bg-panel p-5">
            <SectionHead id="claim-ended">This claim has ended</SectionHead>
            <p className="m-0 mt-3">{endedReason(claim.status, claim.releaseReason)}</p>
            <p className="m-0 mt-1 text-body-s text-ink-muted">
              Ended{" "}
              <span className="font-mono tabular-nums">
                {formatDateTime(claim.endedAt ?? claim.expiresAt)}
              </span>
              .
            </p>
            <ButtonLink variant="primary" href="/review" className="mt-4">
              Back to the review queue
            </ButtonLink>
          </div>
        }
        sections={[]}
      />
    );
  }

  const done = doneMessage(
    { claimed: `Match claimed. It is yours until ${formatDateTime(claim.expiresAt)}.` },
    sp.done,
  );
  const scope = await claimScope(ctx, claim.claimId, { now });
  if (!scope) notFound();
  const [data, facts, themeChoice] = await Promise.all([
    loadWorkspace(scope, { now }),
    claimFacts(scope, ctx.user.id),
    // Outside a request (unit tests) there is no cookie: dark, the default.
    getThemeChoice().catch(() => DEFAULT_THEME),
  ]);
  const meta = [formatMatchDate(match.playedAt), match.competition].filter(Boolean).join(" · ");

  return (
    <>
      <div aria-live="polite" className="mb-4 empty:mb-0">
        {done && <Banner tone="ok">{done}</Banner>}
      </div>
      <ReviewWorkspace
        claimId={claim.claimId}
        fixture={fixtureText(match)}
        meta={meta}
        teams={{ home: match.homeTeam.name, away: match.awayTeam.name }}
        data={data}
        facts={facts}
        hlsUrl={`${claimHlsBase(claim.claimId)}/master.m3u8`}
        clipsOnly={match.clipsOnly}
        rawExpiresAt={match.rawExpiresAt}
        now={now}
        scoutName={ctx.user.name}
        readOnly={!!ctx.impersonator}
        themeChoice={themeChoice}
      />
      <div className="mt-8 grid gap-8 desktop:grid-cols-2">
        <section aria-labelledby="claim-facts" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <SectionHead id="claim-facts">Your claim</SectionHead>
            <ClaimStatusChip status="active" />
          </div>
          <div className="border border-line bg-panel p-4">
            <Facts
              items={[
                ["Time left", <ClaimTimeLeft key="v" expiresAt={claim.expiresAt} now={now} />],
                [
                  "Claim ends",
                  <span key="v" className="font-mono text-mono-m tabular-nums">
                    {formatDateTime(claim.expiresAt)}
                  </span>,
                ],
                [
                  "Claimed",
                  <span key="v" className="font-mono text-mono-m tabular-nums">
                    {formatDateTime(claim.claimedAt)}
                  </span>,
                ],
                ["Events to check", <ToCheckText key="v" count={match.toCheck} />],
                ["Raw footage", <RawFootageFact key="v" row={match} now={now} />],
              ]}
            />
          </div>
          <p className="m-0 text-body-s text-ink-muted">
            Times are South African time. If the time runs out, the match goes back to the queue.
          </p>
        </section>
        <section aria-labelledby="claim-release" className="flex flex-col gap-4">
          <SectionHead id="claim-release">Release</SectionHead>
          <p className="m-0 max-w-prose">
            Release the match if you cannot finish it. It goes back to the queue for other scouts,
            and you can claim it again later if nobody else has.
          </p>
          {/* Q-064: releaseClaim() refuses a "Log in as" session on the server too. */}
          {ctx.impersonator ? (
            <Banner tone="warn">{IMPERSONATION_REFUSED}</Banner>
          ) : (
            <div>
              <ReleaseClaim claimId={claim.claimId} />
            </div>
          )}
        </section>
      </div>
    </>
  );
}
