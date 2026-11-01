import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import { Banner } from "@/components/forms";
import { EmptyState } from "@/components/states/EmptyState";
import { PageHeader } from "@/components/templates/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { expiryLevel } from "@/components/ui/expiry";
import { ExpiryBanner } from "@/components/ui/ExpiryBanner";
import { iconProps } from "@/components/ui/icons";
import { fixtureText, formatDateTime, formatMatchDate } from "@/lib/labels";
import { claimEndsAt } from "@/lib/review-rules";
import { requireReviewerPage } from "@/server/auth/reviewer";
import {
  IMPERSONATION_REFUSED,
  ReviewError,
  reviewErrorCopy,
  REVIEW_ERROR_COPY,
} from "@/server/review/errors";
import { ownLiveClaimId, queueMatch } from "@/server/review/queue";
import { CONFLICT_COOLING_OFF_DAYS } from "@/server/scouts/conflicts";
import { FixtureMarkers } from "../../../../matches/shared";
import {
  CLAIM_HOURS,
  CLIPS_ONLY_NOTICE,
  clubLine,
  lengthText,
  RawFootageFact,
  ToCheckText,
} from "../../../shared";
import { ClaimForm, RefusalLinks } from "./ClaimForm";

export const metadata = { title: "Claim a match" };

type Props = { params: Promise<{ matchId: string }> };

const BACK = { href: "/review", label: "Review queue" };

const TERMS = [
  "Footage streams in Wideline only. You cannot download it.",
  "Footage carries a watermark that identifies you.",
  "Do not record, screenshot or share anything you see.",
  "Players are named only where their family agreed. Others show as side and shirt number.",
];

/**
 * Claim confirmation (REVIEW01, REVIEW02; docs/build/design/C10.md, Surface
 * 2): what the scout takes on, the no-conflict declaration, and Claim match.
 * The same "not available" state for every match the scout cannot claim, so
 * the page never reveals whether a match exists. Draft terms copy (Q-058).
 */
export default async function ClaimMatchPage({ params }: Props) {
  const ctx = await requireReviewerPage();
  const { matchId } = await params;
  const now = new Date();
  const own = await ownLiveClaimId(ctx, matchId, now);
  if (own) redirect(`/review/claims/${encodeURIComponent(own)}`);
  const found = await queueMatch(ctx, matchId, now);

  if (!found) {
    return (
      <div className="max-w-2xl">
        <PageHeader back={BACK} title="Claim a match" />
        <div className="mt-6">
          <EmptyState
            art={false}
            title="This match is not available"
            body="Another scout may have claimed it, or it has been reviewed or deleted."
            action={
              <ButtonLink variant="primary" href="/review">
                Back to the review queue
              </ButtonLink>
            }
          />
        </div>
      </div>
    );
  }

  const { row, claimLimit, atLimit } = found;
  const line = clubLine(row);
  const facts: [string, ReactNode][] = [
    ["Teams", <FixtureMarkers key="v" match={row} />],
    ["Played", formatMatchDate(row.playedAt)],
    [
      "Length",
      <span key="v" className="font-mono text-mono-m tabular-nums">
        {lengthText(row)}
      </span>,
    ],
    ["Events to check", <ToCheckText key="v" count={row.toCheck} />],
    ["Raw footage", <RawFootageFact key="v" row={row} now={now} />],
  ];

  let notice: ReactNode = null;
  if (row.clipsOnly) notice = <Banner tone="warn">{CLIPS_ONLY_NOTICE}</Banner>;
  else if (expiryLevel(row.rawExpiresAt, now) !== "none") {
    notice = (
      <ExpiryBanner deletesAt={row.rawExpiresAt} now={now}>
        Claim it now to add missed events before then.
      </ExpiryBanner>
    );
  }

  // A conflict or a reached limit applies whatever the scout ticks: no form.
  // They take precedence over a "Log in as" session, which applies only to
  // the admin behind it (Q-064); claimMatch() refuses that on the server too.
  const refusal = row.conflicted
    ? { code: "conflict" as const, tone: "danger" as const, copy: REVIEW_ERROR_COPY.conflict }
    : atLimit
      ? {
          code: "claim_limit" as const,
          tone: "danger" as const,
          copy: reviewErrorCopy(new ReviewError("claim_limit", claimLimit)),
        }
      : ctx.impersonator
        ? {
            code: "impersonation_refused" as const,
            tone: "warn" as const,
            copy: IMPERSONATION_REFUSED,
          }
        : null;

  return (
    <div className="max-w-2xl">
      <PageHeader
        back={BACK}
        eyebrow="Claim a match"
        title={fixtureText(row)}
        intro={line || undefined}
      />
      <div className="mt-6 border border-line bg-panel p-4">
        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-1 tablet:grid-cols-[10rem_minmax(0,1fr)] tablet:gap-y-3">
          {facts.map(([term, value]) => (
            <Fragment key={term}>
              <dt className="mt-2 font-mono text-overline text-ink-muted uppercase first:mt-0 tablet:mt-0 tablet:pt-0.5">
                {term}
              </dt>
              <dd className="m-0">{value}</dd>
            </Fragment>
          ))}
        </dl>
      </div>
      {notice && <div className="mt-4">{notice}</div>}

      {refusal ? (
        <div className="mt-8">
          <Banner tone={refusal.tone}>{refusal.copy}</Banner>
          <div className="mt-4 flex flex-col gap-3 tablet:flex-row tablet:items-center">
            <RefusalLinks code={refusal.code} />
          </div>
        </div>
      ) : (
        <>
          <section aria-labelledby="claim-terms-heading">
            <h2
              id="claim-terms-heading"
              className="m-0 mt-8 font-display text-heading-section uppercase stretch-wide"
            >
              If you claim it
            </h2>
            <p className="m-0 mt-4">
              You have {CLAIM_HOURS} hours to review it. If you claim it now, your claim ends on{" "}
              <span className="font-mono tabular-nums">{formatDateTime(claimEndsAt(now))}</span>.
            </p>
            <p className="m-0 mt-2">
              Nobody else can review it while you hold it. If you do not finish in time, it goes
              back to the queue for other scouts. You can release it sooner.
            </p>
            <p className="m-0 mt-2 text-body-s text-ink-muted">Times are South African time.</p>
          </section>
          <section aria-labelledby="claim-reviewer-terms-heading">
            <h2
              id="claim-reviewer-terms-heading"
              className="m-0 mt-8 font-display text-heading-section uppercase stretch-wide"
            >
              Your reviewer terms
            </h2>
            <ul role="list" className="wl-checklist mt-3">
              {TERMS.map((t) => (
                <li key={t}>
                  <ShieldCheck {...iconProps} />
                  <p className="m-0">{t}</p>
                </li>
              ))}
            </ul>
            <Link
              href="/scout#terms"
              className="mt-3 inline-flex min-h-control-l items-center text-brand-text underline tablet:min-h-0"
            >
              Read the full terms
            </Link>
          </section>
          <ClaimForm matchId={row.matchId} coolingOffDays={CONFLICT_COOLING_OFF_DAYS} />
        </>
      )}
    </div>
  );
}
