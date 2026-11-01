import { ArrowDown, ArrowRight, Lock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { DataTable, type DataColumn } from "@/components/templates/DataTable";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ClaimTimeLeft, ClipsTimeLeft } from "@/components/ui/ExpiryBanner";
import { ExpiryChip } from "@/components/ui/ExpiryChip";
import { cx } from "@/components/ui/cx";
import { iconProps } from "@/components/ui/icons";
import { fixtureText, formatDate, formatDateTime } from "@/lib/labels";
import { clipsExpireAt } from "@/lib/review-rules";
import { QUEUE_CAP, type ClaimRow, type QueueRow } from "@/server/review/queue";
import { FixtureMarkers } from "../matches/shared";
import { ConflictNote } from "./ConflictNote";
import { CLAIM_HOURS, clubLine, lengthText, ToCheckText } from "./shared";

/**
 * One section of the review queue (Floodlight, Screens B "Review queue"; REVIEW01,
 * REVIEW13, NFR24). The claimed match sits on top in its own panel with Continue review as
 * the page's only primary. Waiting matches are a DataTable from 768px and a single panel
 * of rows below, always in compareQueue order (footage deleted soonest). Conflicted rows
 * stay in the list, locked, with the reason; at the claim limit, Claim is a disabled
 * button pointing at the limit note.
 */

export const LIMIT_NOTE_ID = "review-limit-note";

type Common = {
  id: string;
  title: string;
  /** The section's top margin. */
  className?: string;
  now: Date;
};

function Heading({
  id,
  title,
  count,
  aside,
  phoneHidden = false,
}: {
  id: string;
  title: string;
  count: number;
  aside?: ReactNode;
  /** Visually hidden below 768px, where the card carries the same label. */
  phoneHidden?: boolean;
}) {
  return (
    <div
      className={cx(
        "mb-3 flex flex-wrap items-baseline justify-between gap-2",
        phoneHidden && "touch:sr-only",
      )}
    >
      <h2 id={id} className="m-0 font-display text-heading-section uppercase stretch-wide">
        {title}
        <span className="sr-only">
          , {count} {count === 1 ? "match" : "matches"}
        </span>
      </h2>
      {aside}
    </div>
  );
}

/** "Footage deleted soonest", beside the waiting heading: the sort can't be changed. */
function SortHint() {
  return (
    <span className="flex items-center gap-1.5 font-mono text-mono-m text-ink-muted">
      <ArrowDown {...iconProps} size={14} />
      Footage deleted soonest
    </span>
  );
}

/** "Hilton College · U15 · Pilot league · 18 Oct · 2 × 35 min", missing parts left out. */
function metaLine(row: QueueRow, extra?: string): string {
  return [clubLine(row), formatDate(row.playedAt), lengthText(row), extra]
    .filter(Boolean)
    .join(" · ");
}

function Meta({ children }: { children: ReactNode }) {
  return (
    // leading-[1.3]: mono-m's line height is 1, too tight when the line wraps on phones.
    <span className="block font-mono text-mono-m leading-[1.3] text-ink-muted tabular-nums">
      {children}
    </span>
  );
}

/** The footage countdown chip, or the clips line once raw footage is gone. */
function FootageLeft({ row, now }: { row: QueueRow; now: Date }) {
  return row.clipsOnly ? (
    <ClipsTimeLeft clipsExpireAt={clipsExpireAt(row.rawExpiresAt)} now={now} />
  ) : (
    <ExpiryChip deletesAt={row.rawExpiresAt} now={now} />
  );
}

function Fixture({ row, wrap = false }: { row: QueueRow; wrap?: boolean }) {
  return (
    <span
      className={cx(
        "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-semibold",
        wrap ? "break-words" : undefined,
      )}
    >
      <FixtureMarkers match={row} />
    </span>
  );
}

/** Your claimed match: one panel per live claim, Continue review as the primary. */
export function MineSection({
  id,
  title,
  className,
  now,
  rows,
  claimLimit,
}: Common & { rows: ClaimRow[]; claimLimit: number }) {
  // Continue review is the page's one primary; with a limit of 2 or more, later rows are secondary.
  const variant = (i: number) => (i === 0 || claimLimit < 2 ? "primary" : "secondary");
  return (
    <section aria-labelledby={id} className={className}>
      <Heading id={id} title={title} count={rows.length} phoneHidden />
      <ul role="list" className="m-0 flex list-none flex-col gap-3 p-0">
        {rows.map((row, i) => {
          const href = `/review/claims/${row.claimId}`;
          return (
            <li
              key={row.claimId}
              className="border border-line bg-panel shadow-[inset_2px_0_0_var(--wl-color-ink)]"
            >
              {/* 768px and up: the four-column panel. */}
              <div className="hidden items-center gap-4 p-4 tablet:grid tablet:grid-cols-[8.25rem_minmax(0,1fr)_auto] desktop:grid-cols-[8.25rem_minmax(0,1fr)_13.75rem_auto]">
                <span className="flex">
                  <FootageLeft row={row} now={now} />
                </span>
                <span className="flex min-w-0 flex-col gap-2">
                  <Fixture row={row} />
                  <Meta>{metaLine(row, `claimed ${formatDateTime(row.claimedAt)}`)}</Meta>
                  {/* 768 to 991px: no third column, so the claim's time left sits here. */}
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-s desktop:hidden">
                    <ToCheckText count={row.toCheck} />
                    <ClaimTimeLeft expiresAt={row.claimExpiresAt} now={now} />
                  </span>
                </span>
                <span className="hidden flex-col gap-2 text-body-s desktop:flex">
                  <ToCheckText count={row.toCheck} />
                  <ClaimTimeLeft expiresAt={row.claimExpiresAt} now={now} />
                </span>
                <ButtonLink variant={variant(i)} href={href} className="whitespace-nowrap">
                  Continue review
                  <span className="sr-only"> {fixtureText(row)}</span>
                  <ArrowRight {...iconProps} />
                </ButtonLink>
              </div>
              {/* Phones: the whole card is the link. */}
              <Link
                href={href}
                className="flex flex-col gap-2.5 p-3.5 text-ink no-underline tablet:hidden"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-body-s font-semibold text-ink-muted">{title}</span>
                  <FootageLeft row={row} now={now} />
                </span>
                <span className="font-semibold break-words">{fixtureText(row)}</span>
                <Meta>{metaLine(row)}</Meta>
                <span className="flex items-center justify-between gap-2">
                  <span className="flex flex-col gap-1 text-body-s">
                    <ToCheckText count={row.toCheck} />
                    <ClaimTimeLeft expiresAt={row.claimExpiresAt} now={now} />
                  </span>
                  <span className="flex items-center gap-1 font-semibold text-brand-text">
                    Continue
                    <ArrowRight {...iconProps} />
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Waiting to be claimed, or Clips only. `limitNote` says whether this section holds the
 * limit note ("here"), relies on an earlier section's ("elsewhere"), or needs none.
 */
export function WaitingSection({
  id,
  title,
  className,
  now,
  rows,
  clips,
  atLimit,
  claimLimit,
  limitNote,
  capped = false,
  filter,
  emptyText,
}: Common & {
  /** The age-group filter, beside the sort hint. */
  filter?: ReactNode;
  rows: QueueRow[];
  clips: boolean;
  atLimit: boolean;
  claimLimit: number;
  limitNote: "here" | "elsewhere" | null;
  capped?: boolean;
  /** Shown in place of the table when there are no rows. */
  emptyText?: string;
}) {
  const allConflicted = rows.length > 0 && rows.every((r) => r.conflicted);
  const columns: DataColumn[] = [
    { id: "footage", header: clips ? "Clips left" : "Footage left", width: "9.5rem" },
    { id: "match", header: "Match" },
    { id: "events", header: "Events", width: "11rem" },
    { id: "action", header: "", label: "Action", width: "8rem" },
  ];

  const reasonId = (row: QueueRow) => `${id}-locked-${row.matchId}`;

  const action = (row: QueueRow, phone: boolean) => {
    if (row.conflicted) {
      if (phone) {
        return (
          <span className="flex h-control-l items-center gap-1.5 text-body-s text-ink-muted">
            <Lock {...iconProps} />
            Locked
          </span>
        );
      }
      return (
        <Button variant="secondary" size="m" icon={Lock} disabled aria-describedby={reasonId(row)}>
          Locked
        </Button>
      );
    }
    const label = (
      <>
        Claim
        <span className="sr-only">
          {" "}
          {fixtureText(row)}, played {formatDate(row.playedAt)}
        </span>
      </>
    );
    const size = phone ? "l" : "m";
    if (atLimit) {
      return (
        <Button variant="secondary" size={size} disabled aria-describedby={LIMIT_NOTE_ID}>
          {label}
        </Button>
      );
    }
    return (
      <ButtonLink variant="secondary" size={size} href={`/review/matches/${row.matchId}/claim`}>
        {label}
      </ButtonLink>
    );
  };

  return (
    <section aria-labelledby={id} className={className}>
      <Heading
        id={id}
        title={title}
        count={rows.length}
        aside={
          filter || (rows.length > 1 && !clips) ? (
            <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {rows.length > 1 && !clips && <SortHint />}
              {filter}
            </span>
          ) : undefined
        }
      />
      {clips && (
        <p className="m-0 mb-4 max-w-prose text-ink-muted">
          Raw footage for these matches has been deleted. You can still check events against their
          clips, but you cannot add missed events.
        </p>
      )}
      {limitNote === "here" && (
        <p
          id={LIMIT_NOTE_ID}
          className="m-0 mb-4 flex max-w-prose items-center gap-2 text-ink-muted"
        >
          <Lock {...iconProps} />
          {claimLimit < 2
            ? "Finish or release your claimed match to claim another."
            : "Finish or release one of your claimed matches to claim another."}
        </p>
      )}
      {allConflicted && (
        <p className="m-0 mb-4 max-w-prose text-ink-muted">
          You cannot claim any of these matches because you are linked to a club or player in each
          of them.{" "}
          <Link href="/scout#scout-conflicts-heading" className="text-brand-text underline">
            Check your list on your scout profile
          </Link>
        </p>
      )}
      {rows.length === 0 ? (
        <p className="m-0 max-w-prose text-ink-muted">{emptyText}</p>
      ) : (
        <DataTable
          caption={
            clips
              ? "Clips-only matches, soonest clip deletion first"
              : "Matches waiting for a reviewer, soonest footage deletion first"
          }
          columns={columns}
          rows={rows.map((row) => ({
            id: row.matchId,
            cells: [
              <span key="footage" className="flex">
                <FootageLeft row={row} now={now} />
              </span>,
              <span
                key="match"
                className={cx("flex min-w-0 flex-col gap-2", row.conflicted && "text-ink-muted")}
              >
                <Fixture row={row} wrap />
                <Meta>{metaLine(row)}</Meta>
                {row.conflicted && <ConflictNote id={reasonId(row)} />}
              </span>,
              <span key="events" className="text-body-s">
                <ToCheckText count={row.toCheck} />
              </span>,
              <span key="action" className="flex justify-end whitespace-nowrap">
                {action(row, false)}
              </span>,
            ],
          }))}
          cards={rows.map((row) => (
            <li
              key={row.matchId}
              className="wl-queue-card flex flex-col gap-2 border-b border-line bg-panel p-3.5 last:border-b-0"
            >
              <span className="flex items-center justify-between gap-2">
                <FootageLeft row={row} now={now} />
                <span className="font-mono text-mono-m text-ink-muted tabular-nums">
                  {lengthText(row)}
                </span>
              </span>
              <span
                className={cx(
                  "min-w-0 font-semibold break-words",
                  row.conflicted && "text-ink-muted",
                )}
              >
                <FixtureMarkers match={row} stacked wrap />
              </span>
              <Meta>{[clubLine(row), formatDate(row.playedAt)].filter(Boolean).join(" · ")}</Meta>
              {row.conflicted && <ConflictNote />}
              <span className="flex items-center justify-between gap-2">
                <span className="text-body-s text-ink-muted">
                  <ToCheckText count={row.toCheck} />
                </span>
                {action(row, true)}
              </span>
            </li>
          ))}
        />
      )}
      {capped && (
        <p className="m-0 mt-2 text-body-s text-ink-muted">
          Showing the {QUEUE_CAP} matches with the soonest footage deletion.
        </p>
      )}
      {!clips && rows.length > 0 && (
        <p className="m-0 mt-3 text-body-s text-ink-muted">
          Claiming gives you {CLAIM_HOURS} hours. You can release a match at any time.
        </p>
      )}
    </section>
  );
}
