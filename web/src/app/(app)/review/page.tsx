import { Banner } from "@/components/forms";
import { EmptyState } from "@/components/states/EmptyState";
import { ListPage } from "@/components/templates/ListPage";
import { expiryLevel, formatDeletionDate } from "@/components/ui/expiry";
import { ExpiryBanner } from "@/components/ui/ExpiryBanner";
import { fixtureText } from "@/lib/labels";
import { requireReviewerPage } from "@/server/auth/reviewer";
import { reviewQueue, type QueueRow } from "@/server/review/queue";
import { doneMessage } from "../matches/shared";
import { MineSection, WaitingSection } from "./QueueSection";
import { CLAIM_HOURS, limitSentence } from "./shared";

export const metadata = { title: "Review queue" };

const DONE = { released: "Match released. It is back in the queue for other scouts." };

const within72h = (row: QueueRow, now: Date) =>
  !row.clipsOnly && expiryLevel(row.rawExpiresAt, now) !== "none";

/**
 * The shared review queue (REVIEW01, REVIEW02, REVIEW13, NFR24;
 * docs/build/design/C10.md, Surface 1): the scout's own claims, then matches
 * waiting for a reviewer, then clips-only matches, each soonest footage
 * deletion first. Match-level facts only. Times are worked out once, at
 * render; nothing ticks (Q-061).
 */
export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const ctx = await requireReviewerPage();
  const now = new Date();
  const [queue, params] = await Promise.all([reviewQueue(ctx, { now }), searchParams]);
  const { mine, waiting, clipsOnly, claimLimit, atLimit, capped } = queue;
  const done = doneMessage(DONE, params.done);
  const limit = limitSentence(claimLimit);

  // At most one banner: the scout's own match first, then the soonest
  // claimable waiting match. Conflicted matches never drive it.
  const own = mine.find((r) => !r.clipsOnly);
  const claimable = waiting.find((r) => !r.conflicted);
  let banner = null;
  if (own && within72h(own, now)) {
    banner = (
      <ExpiryBanner expiresAt={own.rawExpiresAt} now={now}>
        {fixtureText(own)} is yours to review. Finish it before{" "}
        {formatDeletionDate(own.rawExpiresAt)} to add missed events.
      </ExpiryBanner>
    );
  } else if (claimable && within72h(claimable, now)) {
    banner = (
      <ExpiryBanner expiresAt={claimable.rawExpiresAt} now={now}>
        {fixtureText(claimable)} is waiting for a reviewer.{" "}
        {atLimit
          ? "Release or finish your claimed match to claim it."
          : `Claim it before ${formatDeletionDate(claimable.rawExpiresAt)} so missed events can still be added.`}
      </ExpiryBanner>
    );
  }

  // The limit note sits in the first section with a claimable row; later
  // sections point at it.
  const noteInWaiting = atLimit && waiting.some((r) => !r.conflicted);
  const noteInClips = atLimit && !noteInWaiting && clipsOnly.some((r) => !r.conflicted);
  const isEmpty = mine.length + waiting.length + clipsOnly.length === 0;
  const lead = Boolean(done || banner);
  // ListPage already spaces its content from the header: the first section
  // needs a margin only after a notice or banner.
  const firstClass = lead ? "mt-6" : undefined;

  return (
    <ListPage
      header={{
        title: "Review queue",
        intro: (
          <>
            Matches to claim, soonest footage deletion first.
            <span className="caption mt-1 block">
              {limit ? `${limit} ` : ""}Each claim lasts {CLAIM_HOURS} hours.
            </span>
          </>
        ),
      }}
    >
      <div aria-live="polite">{done && <Banner tone="ok">{done}</Banner>}</div>
      {banner && <div className={done ? "mt-4" : undefined}>{banner}</div>}
      {isEmpty ? (
        <div className={lead ? "mt-6" : undefined}>
          <EmptyState
            title="No matches waiting"
            body="New matches appear here as clubs upload them."
          />
        </div>
      ) : (
        <>
          {mine.length > 0 && (
            <MineSection
              id="review-mine"
              title="Your matches"
              className={firstClass}
              now={now}
              rows={mine}
              claimLimit={claimLimit}
            />
          )}
          <WaitingSection
            id="review-waiting"
            title="Waiting for a reviewer"
            className={mine.length === 0 ? firstClass : "mt-8"}
            now={now}
            rows={waiting}
            clips={false}
            atLimit={atLimit}
            claimLimit={claimLimit}
            limitNote={noteInWaiting ? "here" : null}
            capped={capped}
            emptyText="No other matches waiting. New matches appear here as clubs upload them."
          />
          {clipsOnly.length > 0 && (
            <WaitingSection
              id="review-clips"
              title="Clips only"
              className="mt-8"
              now={now}
              rows={clipsOnly}
              clips
              atLimit={atLimit}
              claimLimit={claimLimit}
              limitNote={noteInClips ? "here" : noteInWaiting ? "elsewhere" : null}
            />
          )}
        </>
      )}
    </ListPage>
  );
}
