import { notFound } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import { Banner } from "@/components/forms";
import { DetailPage, type DetailSection } from "@/components/templates/DetailPage";
import { ButtonLink } from "@/components/ui/Button";
import { expiryLevel, formatDeletionDate } from "@/components/ui/expiry";
import { ClaimTimeLeft, ExpiryBanner, ExpiryLabel } from "@/components/ui/ExpiryBanner";
import { ClaimStatusChip } from "@/components/ui/StatusChip";
import type { ReviewClaimStatus, ReviewReleaseReason } from "@/generated/prisma/enums";
import { fixtureText, formatDateTime, formatMatchDate } from "@/lib/labels";
import { requireReviewerPage } from "@/server/auth/reviewer";
import { ownClaim } from "@/server/review/claims";
import { IMPERSONATION_REFUSED } from "@/server/review/errors";
import { doneMessage } from "../../../matches/shared";
import { CLAIM_HOURS, CLIPS_ONLY_NOTICE, RawFootageFact, ToCheckText } from "../../shared";
import { ReleaseClaim } from "./ReleaseClaim";

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
    <dl className="wl-facts">
      {items.map(([term, value]) => (
        <Fragment key={term}>
          <dt className="label">{term}</dt>
          <dd className="body">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/**
 * The scout's claimed match (REVIEW01; docs/build/design/C10.md, Surface 3):
 * how long they have, and Release. C11 turns the Review section into the
 * workspace. Another scout's claim, or an unknown id, is not found. An active
 * claim past its end reads as expired (lazy expiry, A-5).
 */
export default async function ClaimedMatchPage({ params, searchParams }: Props) {
  const ctx = await requireReviewerPage();
  const [{ claimId }, sp] = await Promise.all([params, searchParams]);
  const now = new Date();
  const claim = await ownClaim(ctx, claimId, now);
  if (!claim) notFound();
  const { match } = claim;
  const meta = [
    formatMatchDate(match.playedAt),
    match.organisationName,
    match.ageGroup,
    match.competition,
  ]
    .filter(Boolean)
    .join(" · ");
  const hero = {
    back: BACK,
    eyebrow: "Your claimed match",
    title: fixtureText(match),
    meta,
  };

  if (claim.status !== "active") {
    return (
      <DetailPage
        {...hero}
        badges={<ClaimStatusChip status={claim.status} />}
        notice={
          <div className="wl-card mt-6">
            <h2 className="heading-2">This claim has ended</h2>
            <p className="body mt-2">{endedReason(claim.status, claim.releaseReason)}</p>
            <p className="caption mt-1 text-ink-muted">
              Ended {formatDateTime(claim.endedAt ?? claim.expiresAt)}.
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
  const footageSoon = !match.clipsOnly && expiryLevel(match.rawExpiresAt, now) !== "none";

  const sections: DetailSection[] = [
    {
      id: "claim",
      title: "Your claim",
      content: (
        <div className="max-w-2xl">
          <div className="wl-card">
            <Facts
              items={[
                ["Time left", <ClaimTimeLeft key="v" expiresAt={claim.expiresAt} now={now} />],
                [
                  "Claim ends",
                  <span key="v" className="data">
                    {formatDateTime(claim.expiresAt)}
                  </span>,
                ],
                [
                  "Claimed",
                  <span key="v" className="data">
                    {formatDateTime(claim.claimedAt)}
                  </span>,
                ],
                ["Events to check", <ToCheckText key="v" count={match.toCheck} />],
                ["Raw footage", <RawFootageFact key="v" row={match} now={now} />],
              ]}
            />
          </div>
          <p className="caption mt-2 text-ink-muted">
            Times are South African time. If the time runs out, the match goes back to the queue.
          </p>
        </div>
      ),
    },
    {
      id: "review",
      title: "Review",
      // Draft copy: C11 replaces this section with the workspace.
      content: (
        <p className="body max-w-prose">
          The review workspace opens here. You will watch the footage, confirm or correct each
          event, and add missed ones.
        </p>
      ),
    },
    {
      id: "release",
      title: "Release",
      content: (
        <div className="max-w-2xl">
          <p className="body mb-4 max-w-prose">
            Release the match if you cannot finish it. It goes back to the queue for other scouts,
            and you can claim it again later if nobody else has.
          </p>
          {/* Q-064: releaseClaim() refuses a "Log in as" session on the server too. */}
          {ctx.impersonator ? (
            <Banner tone="warn">{IMPERSONATION_REFUSED}</Banner>
          ) : (
            <ReleaseClaim claimId={claim.claimId} />
          )}
        </div>
      ),
    },
  ];

  return (
    <DetailPage
      {...hero}
      badges={
        <>
          <ClaimStatusChip status="active" />
          {footageSoon && <ExpiryLabel expiresAt={match.rawExpiresAt} now={now} />}
        </>
      }
      notice={
        <>
          <div aria-live="polite" className="mt-6 empty:mt-0">
            {done && <Banner tone="ok">{done}</Banner>}
          </div>
          {match.clipsOnly ? (
            <div className="mt-4">
              <Banner tone="warn">{CLIPS_ONLY_NOTICE}</Banner>
            </div>
          ) : (
            footageSoon && (
              <div className="mt-4">
                <ExpiryBanner expiresAt={match.rawExpiresAt} now={now}>
                  Finish your review before {formatDeletionDate(match.rawExpiresAt)} to add missed
                  events. Stats you confirm are kept.
                </ExpiryBanner>
              </div>
            )
          )}
        </>
      }
      sections={sections}
    />
  );
}
