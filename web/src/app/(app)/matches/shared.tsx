import { CircleAlert, Clock, LoaderCircle, TriangleAlert, Upload, X } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Missing } from "@/components/templates/DataTable";
import { cx } from "@/components/ui/cx";
import { expiryLevel, formatTimeLeft } from "@/components/ui/expiry";
import { ExpiryLabel } from "@/components/ui/ExpiryBanner";
import { iconProps } from "@/components/ui/icons";
import type { FootageState } from "@/components/ui/StatusChip";
import { TeamMarker } from "@/components/ui/TeamMarker";
import type { FootageIssue } from "@/lib/footage-rules";
import { formatReadyBy } from "@/lib/labels";
import { estimatedReadyAt } from "@/server/matches/estimate";
import type { MatchSummary, VideoSummary } from "@/server/matches/matches";

// Pieces shared by the C06 match pages (docs/build/design/C06.md).

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

/** The fixture as home and away TeamMarkers, "v" between (Surface 1). */
export function FixtureMarkers({
  match,
  stacked = false,
}: {
  match: MatchSummary;
  stacked?: boolean;
}) {
  if (stacked) {
    return (
      <span className="flex min-w-0 flex-col gap-1">
        <TeamMarker side="home" name={match.homeTeam.name} truncate />
        <span className="sr-only"> v </span>
        <TeamMarker side="away" name={match.awayTeam.name} truncate />
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

function InlineStatus({
  tone,
  icon: Icon,
  children,
}: {
  tone: "muted" | "warn" | "danger";
  icon: typeof Clock;
  children: ReactNode;
}) {
  return (
    <span className={cx("wl-inline-status caption", `wl-inline-status--${tone}`)}>
      <Icon {...iconProps} />
      {children}
    </span>
  );
}

const HOUR = 60 * 60 * 1000;

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
      if (expiryLevel(expires, now) !== "none")
        return <ExpiryLabel expiresAt={expires} now={now} />;
      return (
        <InlineStatus tone="muted" icon={Clock}>
          Footage deleted in {formatTimeLeft(expires.getTime() - now.getTime())}
        </InlineStatus>
      );
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
    <ul className="wl-issues mt-4" role="list">
      {issues.map((issue) => {
        const reject = issue.severity === "reject";
        const Icon = reject ? CircleAlert : TriangleAlert;
        return (
          <li key={issue.code} className={reject ? "wl-issues__reject" : "wl-issues__warn"}>
            <Icon {...iconProps} />
            <p className="body-strong">
              <span className="sr-only">{reject ? "Problem: " : "Warning: "}</span>
              {issue.message}
            </p>
            <p className="body text-ink-muted">{issue.guidance}</p>
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
      className={cx("body-strong text-pitch underline break-words", className)}
    >
      <FixtureMarkers match={match} />
    </Link>
  );
}
