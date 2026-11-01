import { Banner } from "@/components/forms";
import { EmptyState } from "@/components/states/EmptyState";
import { ListPage } from "@/components/templates/ListPage";
import { expiryLevel, formatDeletionDate } from "@/components/ui/expiry";
import { ExpiryBanner } from "@/components/ui/ExpiryBanner";
import { fixtureText } from "@/lib/labels";
import { requireReviewerPage } from "@/server/auth/reviewer";
import { reviewQueue, type QueueRow } from "@/server/review/queue";
import { doneMessage } from "../matches/shared";
import { AgeGroupFilter } from "./AgeGroupFilter";
import { MineSection, WaitingSection } from "./QueueSection";
import { CLAIM_HOURS, limitSentence } from "./shared";

export const metadata = { title: "Review queue" };

const DONE = { released: "Match released. It is back in the queue for other scouts." };

const within72h = (row: QueueRow, now: Date) =>
  !row.clipsOnly && expiryLevel(row.rawExpiresAt, now) !== "none";

/**
 * The shared review queue (Floodlight, Screens B "Review queue"; REVIEW01, REVIEW02,
 * REVIEW13, NFR24): the scout's claimed match on top with Continue review, then matches
 * waiting to be claimed, then clips-only matches, each soonest footage deletion first.
 * Match-level facts only. Times are worked out at render; the countdown chips move on
 * once a minute and never tick seconds.
 */
export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; age?: string }>;
}) {
  const ctx = await requireReviewerPage();
  const now = new Date();
  const [queue, params] = await Promise.all([reviewQueue(ctx, { now }), searchParams]);
  const { mine, claimLimit, atLimit, capped } = queue;
  // "All age groups": narrows the rows already fetched; the order stays the queue's.
  const ages = [
    ...new Set(
      [...queue.waiting, ...queue.clipsOnly].map((r) => r.ageGroup).filter((a) => a !== null),
    ),
  ].sort((a, b) => a.localeCompare(b, "en-ZA", { numeric: true }));
  const age = params.age && ages.includes(params.age) ? params.age : "";
  const byAge = (rows: QueueRow[]) => (age ? rows.filter((r) => r.ageGroup === age) : rows);
  const waiting = byAge(queue.waiting);
  const clipsOnly = byAge(queue.clipsOnly);
  const ageFilter = ages.length > 1 ? <AgeGroupFilter value={age} options={ages} /> : undefined;
  const done = doneMessage(DONE, params.done);
  const limit = limitSentence(claimLimit);

  // At most one banner: the scout's own match first, then the soonest
  // claimable waiting match. Conflicted matches never drive it.
  const own = mine.find((r) => !r.clipsOnly);
  const claimable = queue.waiting.find((r) => !r.conflicted);
  let banner = null;
  if (own && within72h(own, now)) {
    banner = (
      <ExpiryBanner deletesAt={own.rawExpiresAt} now={now}>
        {fixtureText(own)} is yours to review. Finish it before{" "}
        {formatDeletionDate(own.rawExpiresAt)} to add missed events.
      </ExpiryBanner>
    );
  } else if (claimable && within72h(claimable, now)) {
    banner = (
      <ExpiryBanner deletesAt={claimable.rawExpiresAt} now={now}>
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
  const isEmpty = mine.length + queue.waiting.length + queue.clipsOnly.length === 0;
  const lead = Boolean(done || banner);
  const firstClass = lead ? "mt-6" : undefined;
  const waitingCount = queue.waiting.length + queue.clipsOnly.length;

  return (
    <ListPage
      header={{
        title: "Review queue",
        intro: (
          <>
            {!isEmpty && (
              <span className="block font-mono text-mono-m text-ink-muted tabular-nums">
                {waitingCount === 1 ? "1 match waiting" : `${waitingCount} matches waiting`} ·
                deleted soonest first
              </span>
            )}
            <span className="mt-1 block text-body-s text-ink-muted">
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
            body="No matches waiting. New matches appear here as clubs upload them."
          />
        </div>
      ) : (
        <>
          {mine.length > 0 && (
            <MineSection
              id="review-mine"
              title={mine.length === 1 ? "Your claimed match" : "Your claimed matches"}
              className={firstClass}
              now={now}
              rows={mine}
              claimLimit={claimLimit}
            />
          )}
          <WaitingSection
            id="review-waiting"
            title="Waiting to be claimed"
            className={mine.length === 0 ? firstClass : "mt-8"}
            now={now}
            rows={waiting}
            clips={false}
            atLimit={atLimit}
            claimLimit={claimLimit}
            limitNote={noteInWaiting ? "here" : null}
            capped={capped}
            filter={ageFilter}
            emptyText={
              age
                ? `No ${age} matches waiting. Choose All age groups to see the rest.`
                : "No other matches waiting. New matches appear here as clubs upload them."
            }
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
