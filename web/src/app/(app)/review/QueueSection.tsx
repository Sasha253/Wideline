import { ArrowRight, Lock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { DataTable, type DataColumn } from "@/components/templates/DataTable";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ClaimTimeLeft, ClipsTimeLeft, FootageTimeLeft } from "@/components/ui/ExpiryBanner";
import { iconProps } from "@/components/ui/icons";
import { fixtureText, formatDate } from "@/lib/labels";
import { clipsExpireAt } from "@/lib/review-rules";
import { QUEUE_CAP, type ClaimRow, type QueueRow } from "@/server/review/queue";
import { FixtureMarkers } from "../matches/shared";
import { ConflictNote } from "./ConflictNote";
import { clubLine, lengthText, ToCheckText } from "./shared";

/**
 * One section of the review queue (REVIEW01, REVIEW13, NFR24;
 * docs/build/design/C10.md, Surface 1): a DataTable from 768px and wl-card
 * cards below. Rows arrive in compareQueue order. Conflicted rows show the
 * ConflictNote in place of Claim; at the claim limit, Claim is a disabled
 * button pointing at the limit note.
 */

export const LIMIT_NOTE_ID = "review-limit-note";

type Common = {
  id: string;
  title: string;
  /** The section's top margin: none at the top of the page, mt-6 after a banner, else mt-8. */
  className?: string;
  now: Date;
};

function Heading({ id, title, count }: { id: string; title: string; count: number }) {
  return (
    <h2 id={id} className="heading-2 mb-4">
      {title} <span className="data ml-2 text-ink-muted">{count}</span>
      <span className="sr-only"> {count === 1 ? "match" : "matches"}</span>
    </h2>
  );
}

function MatchCell({ row, href }: { row: QueueRow; href?: string }) {
  const line = clubLine(row);
  return (
    <>
      {href ? (
        <Link href={href} className="body-strong break-words text-pitch underline">
          <FixtureMarkers match={row} />
        </Link>
      ) : (
        <span className="body-strong break-words">
          <FixtureMarkers match={row} />
        </span>
      )}
      {line && <span className="caption block text-ink-muted">{line}</span>}
    </>
  );
}

const played = (row: QueueRow) => (
  <span className="data whitespace-nowrap">{formatDate(row.playedAt)}</span>
);

function FootageCell({ row, now }: { row: QueueRow; now: Date }) {
  return row.clipsOnly ? (
    <ClipsTimeLeft clipsExpireAt={clipsExpireAt(row.rawExpiresAt)} now={now} />
  ) : (
    <FootageTimeLeft expiresAt={row.rawExpiresAt} now={now} />
  );
}

/** The phone card body shared by every section: fixture, club line, date and time left. */
function CardFacts({
  row,
  now,
  fixture,
  claim,
}: {
  row: QueueRow;
  now: Date;
  fixture: ReactNode;
  claim?: ReactNode;
}) {
  const line = clubLine(row);
  return (
    <>
      {fixture}
      <p className="caption text-ink-muted">
        {line && <span className="block">{line}</span>}
        <span className="block">
          <span className="data">{formatDate(row.playedAt)}</span> · {lengthText(row)}
        </span>
      </p>
      <div className="wl-row">
        {claim}
        <FootageCell row={row} now={now} />
        <span className="caption">
          <ToCheckText count={row.toCheck} />
        </span>
      </div>
    </>
  );
}

/** Your matches: the caller's live claims, each with Open. */
export function MineSection({
  id,
  title,
  className,
  now,
  rows,
  claimLimit,
}: Common & { rows: ClaimRow[]; claimLimit: number }) {
  // Open is the page's one primary; with a limit of 2 or more, later rows are secondary.
  const variant = (i: number) => (i === 0 || claimLimit < 2 ? "primary" : "secondary");
  const open = (row: ClaimRow, i: number, block: boolean) => (
    <ButtonLink
      variant={variant(i)}
      size="sm"
      block={block}
      className={block ? "justify-center" : undefined}
      href={`/review/claims/${row.claimId}`}
    >
      Open
      <span className="sr-only"> {fixtureText(row)}</span>
      <ArrowRight {...iconProps} />
    </ButtonLink>
  );
  const columns: DataColumn[] = [
    { id: "match", header: "Match" },
    { id: "played", header: "Played" },
    { id: "check", header: "To check", numeric: true },
    { id: "claim", header: "Claim" },
    { id: "footage", header: "Footage" },
    { id: "action", header: <span className="sr-only">Action</span> },
  ];
  return (
    <section aria-labelledby={id} className={className}>
      <Heading id={id} title={title} count={rows.length} />
      <DataTable
        caption="Your claimed matches"
        columns={columns}
        rows={rows.map((row, i) => ({
          id: row.claimId,
          cells: [
            <MatchCell key="match" row={row} href={`/review/claims/${row.claimId}`} />,
            <span key="played">{played(row)}</span>,
            row.toCheck,
            <ClaimTimeLeft key="claim" expiresAt={row.claimExpiresAt} now={now} />,
            <FootageCell key="footage" row={row} now={now} />,
            <span key="action" className="whitespace-nowrap">
              {open(row, i, false)}
            </span>,
          ],
        }))}
        cards={rows.map((row, i) => (
          <li key={row.claimId} className="wl-card flex flex-col gap-3">
            <CardFacts
              row={row}
              now={now}
              fixture={
                <Link
                  href={`/review/claims/${row.claimId}`}
                  className="wl-link-row body-strong min-w-0 text-pitch underline"
                >
                  <FixtureMarkers match={row} stacked wrap />
                </Link>
              }
              claim={<ClaimTimeLeft expiresAt={row.claimExpiresAt} now={now} />}
            />
            {open(row, i, true)}
          </li>
        ))}
      />
    </section>
  );
}

/**
 * Waiting for a reviewer, or Clips only. `limitNote` says whether this
 * section holds the limit note ("here"), relies on an earlier section's
 * ("elsewhere"), or needs none.
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
  emptyText,
}: Common & {
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
    { id: "match", header: "Match" },
    { id: "played", header: "Played" },
    { id: "length", header: "Length" },
    { id: "check", header: "To check", numeric: true },
    { id: "footage", header: clips ? "Clips" : "Footage" },
    { id: "action", header: <span className="sr-only">Action</span> },
  ];
  const action = (row: QueueRow, block: boolean) => {
    if (row.conflicted) return <ConflictNote />;
    const label = (
      <>
        Claim
        <span className="sr-only">
          {" "}
          {fixtureText(row)}, played {formatDate(row.playedAt)}
        </span>
      </>
    );
    const look = { variant: "secondary", size: "sm", block } as const;
    const className = block ? "justify-center" : undefined;
    if (atLimit) {
      return (
        <Button {...look} className={className} disabled aria-describedby={LIMIT_NOTE_ID}>
          {label}
        </Button>
      );
    }
    return (
      <ButtonLink {...look} className={className} href={`/review/matches/${row.matchId}/claim`}>
        {label}
      </ButtonLink>
    );
  };

  return (
    <section aria-labelledby={id} className={className}>
      <Heading id={id} title={title} count={rows.length} />
      {clips && (
        <p className="body mb-4 max-w-prose text-ink-muted">
          Raw footage for these matches has been deleted. You can still check events against their
          clips, but you cannot add missed events.
        </p>
      )}
      {limitNote === "here" && (
        <p
          id={LIMIT_NOTE_ID}
          className="wl-inline-status wl-inline-status--muted body mb-4 max-w-prose"
        >
          <Lock {...iconProps} />
          {claimLimit < 2
            ? "Finish or release your claimed match to claim another."
            : "Finish or release one of your claimed matches to claim another."}
        </p>
      )}
      {allConflicted && (
        <p className="body mb-4 max-w-prose text-ink-muted">
          You cannot claim any of these matches because you are linked to a club or player in each
          of them.{" "}
          <Link
            href="/scout#scout-conflicts-heading"
            className="body wl-link-row text-pitch underline"
          >
            Check your list on your scout profile
          </Link>
        </p>
      )}
      {rows.length === 0 ? (
        <p className="body max-w-prose text-ink-muted">{emptyText}</p>
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
              <MatchCell key="match" row={row} />,
              <span key="played">{played(row)}</span>,
              <span key="length" className="data whitespace-nowrap">
                {lengthText(row)}
              </span>,
              row.toCheck,
              <FootageCell key="footage" row={row} now={now} />,
              <span key="action" className="whitespace-nowrap">
                {action(row, false)}
              </span>,
            ],
          }))}
          cards={rows.map((row) => (
            <li key={row.matchId} className="wl-card flex flex-col gap-3">
              <CardFacts
                row={row}
                now={now}
                fixture={
                  <span className="body-strong min-w-0">
                    <FixtureMarkers match={row} stacked wrap />
                  </span>
                }
              />
              {action(row, true)}
            </li>
          ))}
        />
      )}
      {capped && (
        <p className="caption mt-2 text-ink-muted">
          Showing the {QUEUE_CAP} matches with the soonest footage deletion.
        </p>
      )}
    </section>
  );
}
