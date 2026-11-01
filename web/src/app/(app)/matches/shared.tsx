import { CircleAlert, Clock, LoaderCircle, TriangleAlert, Upload, X } from "lucide-react";
import Link from "next/link";
import { Missing } from "@/components/templates/DataTable";
import { cx } from "@/components/ui/cx";
import { FootageTimeLeft, InlineStatus } from "@/components/ui/ExpiryBanner";
import { ExpiryChip } from "@/components/ui/ExpiryChip";
import { iconProps } from "@/components/ui/icons";
import type { FootageState } from "@/components/ui/StatusChip";
import { TeamMarker } from "@/components/ui/TeamMarker";
import type { FootageIssue } from "@/lib/footage-rules";
import { formatReadyBy } from "@/lib/labels";
import { estimatedReadyAt } from "@/server/matches/estimate";
import type { MatchSummary, VideoSummary } from "@/server/matches/matches";

// Pieces shared by the match pages (docs/build/design/C06.md; Floodlight Screens A).

/** The chip state of a video: accepted with warnings is its own state. */
export function footageState(video: VideoSummary): FootageState {
  if (video.status === "accepted" && video.validation?.verdict === "accepted_with_warnings") {
    return "accepted_with_warnings";
  }
  return video.status;
}

/** Raw footage still stored: an upload time, not deleted, not past its expiry. */
export function rawExpiry(video: VideoSummary | null): Date | null {
  if (!video?.rawExpiresAt || video.deletedAt) return null;
  return video.rawExpiresAt;
}

/** "?done=" codes this page knows, mapped to fixed copy. Anything else shows nothing. */
export function doneMessage(map: Record<string, string>, done: string | undefined): string | null {
  return done && Object.hasOwn(map, done) ? map[done]! : null;
}

type Fixture = {
  homeTeam: { name: string; isOpposition?: boolean };
  awayTeam: { name: string; isOpposition?: boolean };
};

/** The club's side of a match: home unless only the away team is the club's. */
export function ownSide(match: Fixture): "home" | "away" {
  return match.homeTeam.isOpposition && !match.awayTeam.isOpposition ? "away" : "home";
}

/** "v Soweto Stars U17" at home, "at Soweto Stars U17" away (Screens A, match rows). */
export function opponentText(match: Fixture): string {
  const side = ownSide(match);
  const opp = side === "home" ? match.awayTeam : match.homeTeam;
  return `${side === "home" ? "v" : "at"} ${opp.name}`;
}

/**
 * The fixture from the club's side (Screens A, match rows): the H or A marker of the
 * club's team, then "v" or "at" and the opponent. With `link`, the text opens the match.
 */
export function OwnSideFixture({
  match,
  link = false,
  className,
}: {
  match: Fixture & { id?: string };
  link?: boolean;
  className?: string;
}) {
  const side = ownSide(match);
  const own = side === "home" ? match.homeTeam : match.awayTeam;
  const inner = (
    <>
      <TeamMarker side={side} size={20} />
      <span className="min-w-0 truncate">
        <span className="sr-only">{own.name} </span>
        {opponentText(match)}
      </span>
    </>
  );
  const cls = cx("flex min-w-0 items-center gap-2.5 font-medium", className);
  if (link && match.id) {
    return (
      <Link href={`/matches/${match.id}`} className={cx(cls, "underline-offset-3 hover:underline")}>
        {inner}
      </Link>
    );
  }
  return <span className={cls}>{inner}</span>;
}

/**
 * The fixture as home and away TeamMarkers, "v" between. Takes any row with team names
 * (C10 queue rows too). `wrap` lets long names wrap in stacked cards instead of
 * truncating: the review queue needs the full names, so a scout can recognise a conflict
 * (docs/build/design/C10.md).
 */
export function FixtureMarkers({
  match,
  stacked = false,
  wrap = false,
}: {
  match: { homeTeam: { name: string }; awayTeam: { name: string } };
  stacked?: boolean;
  wrap?: boolean;
}) {
  if (stacked) {
    return (
      <span className="flex min-w-0 flex-col gap-1">
        <TeamMarker side="home" name={match.homeTeam.name} truncate={!wrap} />
        <span className="sr-only"> v </span>
        <TeamMarker side="away" name={match.awayTeam.name} truncate={!wrap} />
      </span>
    );
  }
  return (
    <>
      <TeamMarker side="home" name={match.homeTeam.name} />
      <span className="text-ink-muted"> v </span>
      <TeamMarker side="away" name={match.awayTeam.name} />
    </>
  );
}

const HOUR = 60 * 60 * 1000;

/**
 * The footage column of the matches list (Screens A): the expiry countdown chip, so clubs
 * see the same deadline scouts work to; a lock once the footage is deleted; an en dash
 * when there is no stored recording.
 */
export function FootageCell({ match, now }: { match: MatchSummary; now: Date }) {
  const video = match.video;
  if (!video || video.status === "cancelled" || !video.rawExpiresAt) return <Missing />;
  if (video.deletedAt || video.rawExpiresAt.getTime() <= now.getTime()) {
    return <ExpiryChip deletesAt={video.rawExpiresAt} now={now} deleted />;
  }
  return <ExpiryChip deletesAt={video.rawExpiresAt} now={now} />;
}

/** The footage line of a match row (Surface 1, "Footage line"). */
export function FootageLine({ match, now }: { match: MatchSummary; now: Date }) {
  const video = match.video;
  switch (match.status) {
    case "draft":
      if (video?.status === "rejected") {
        return (
          <InlineStatus tone="danger" icon={X}>
            Footage rejected
          </InlineStatus>
        );
      }
      return (
        <InlineStatus tone="muted" icon={Upload}>
          No footage yet
        </InlineStatus>
      );
    case "uploading":
      if (video?.status === "probing") {
        return (
          <InlineStatus tone="muted" icon={LoaderCircle}>
            Checking footage
          </InlineStatus>
        );
      }
      return (
        <InlineStatus tone="warn" icon={Upload}>
          Upload not finished
        </InlineStatus>
      );
    case "processing": {
      const ready = video && estimatedReadyAt(video);
      if (ready && ready.getTime() > now.getTime()) {
        return (
          <InlineStatus tone="muted" icon={Clock}>
            Ready by about {formatReadyBy(ready, now)}
          </InlineStatus>
        );
      }
      return (
        <InlineStatus tone="warn" icon={Clock}>
          Taking longer than usual
        </InlineStatus>
      );
    }
    case "awaiting_review":
    case "in_review": {
      const expires = rawExpiry(video);
      if (!expires || expires.getTime() <= now.getTime()) return <Missing />;
      return <FootageTimeLeft expiresAt={expires} now={now} />;
    }
    default:
      return <Missing />;
  }
}

/** Raw footage with 72 h or less left (for the hero's ExpiryLabel and ExpiryBanner). */
export function expiresSoon(video: VideoSummary | null, now: Date): Date | null {
  const expires = rawExpiry(video);
  if (!expires) return null;
  return expires.getTime() - now.getTime() <= 72 * HOUR ? expires : null;
}

/** Footage issues: icon, message and re-film guidance (Surface 6). */
export function IssueList({ issues }: { issues: FootageIssue[] }) {
  return (
    <ul className="mt-4 flex flex-col border-t border-line" role="list">
      {issues.map((issue) => {
        const reject = issue.severity === "reject";
        const Icon = reject ? CircleAlert : TriangleAlert;
        return (
          <li
            key={issue.code}
            className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-line py-3"
          >
            <Icon
              {...iconProps}
              className={cx("row-span-2 mt-px", reject ? "text-rejected" : "text-pending")}
            />
            <p className="font-semibold">
              <span className="sr-only">{reject ? "Problem: " : "Warning: "}</span>
              {issue.message}
            </p>
            <p className="text-ink-muted">{issue.guidance}</p>
          </li>
        );
      })}
    </ul>
  );
}

/** A link to a match, wrapping its fixture (Surface 1 table cell). */
export function MatchLink({ match, className }: { match: MatchSummary; className?: string }) {
  return (
    <Link
      href={`/matches/${match.id}`}
      className={cx(
        "font-semibold break-words text-brand-text underline underline-offset-3",
        className,
      )}
    >
      <FixtureMarkers match={match} />
    </Link>
  );
}
