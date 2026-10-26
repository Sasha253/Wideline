import { Flag, Pencil, Upload, Users } from "lucide-react";
import { notFound } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import { Banner } from "@/components/forms";
import { DetailPage, type DetailSection } from "@/components/templates/DetailPage";
import { ButtonLink } from "@/components/ui/Button";
import { formatDeletionDate, formatTimeLeft } from "@/components/ui/expiry";
import { ExpiryBanner, ExpiryLabel } from "@/components/ui/ExpiryBanner";
import { FootageChip, MatchStatusChip } from "@/components/ui/StatusChip";
import { TeamMarker } from "@/components/ui/TeamMarker";
import {
  fixtureText,
  formatDate,
  formatDateTime,
  formatFootageLength,
  formatFps,
  formatGB,
  formatMatchDate,
  formatReadyBy,
  formatSize,
  formatVideoTime,
} from "@/lib/labels";
import { MARKER_KEYS, MARKER_LABELS } from "@/lib/match-clock";
import { CLUB_ROLES, requirePageRole } from "@/server/auth/session";
import { limitFor } from "@/server/entitlements";
import { log } from "@/server/log";
import { canDeleteMatch, isLocked, requireSquadOrgPage } from "@/server/matches/access";
import { estimatedReadyAt } from "@/server/matches/estimate";
import type { MatchDetail, SideCounts, VideoSummary } from "@/server/matches/matches";
import { uploadStatus } from "@/server/matches/upload";
import { metaText } from "../../squad/shared";
import { doneMessage, expiresSoon, footageState, IssueList, rawExpiry } from "../shared";
import { DeleteMatch } from "./DeleteMatch";
import { loadMatch } from "./load";
import { StatusPoller } from "./StatusPoller";

type Props = {
  params: Promise<{ matchId: string }>;
  searchParams?: Promise<{ done?: string }>;
};

const DONE = {
  created: "Match created. Upload the footage next.",
  updated: "Changes saved.",
  uploaded: "Upload complete. We are checking the footage now. This usually takes a minute or two.",
};

export async function generateMetadata({ params }: Props) {
  const ctx = requireSquadOrgPage(await requirePageRole(CLUB_ROLES));
  const match = await loadMatch(ctx, (await params).matchId);
  return { title: match ? fixtureText(match) : "Match" };
}

/** A video that counts as footage on this page: a cancelled attempt does not. */
function shownVideo(match: MatchDetail): VideoSummary | null {
  return match.video && match.video.status !== "cancelled" ? match.video : null;
}

function FactList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="wl-facts mt-4">
      {items.map(([label, value]) => (
        <Fragment key={label}>
          <dt className="label">{label}</dt>
          <dd className="body">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function FootageFacts({ video, now }: { video: VideoSummary; now: Date }) {
  const expires = rawExpiry(video);
  const items: [string, ReactNode][] = [];
  if (video.durationSec !== null) {
    items.push([
      "Length",
      <span key="v" className="data">
        {formatFootageLength(video.durationSec)}
      </span>,
    ]);
  }
  if (video.width !== null && video.height !== null) {
    items.push([
      "Resolution",
      <span key="v" className="data">{`${video.width} × ${video.height}`}</span>,
    ]);
  }
  if (video.fps !== null) {
    items.push([
      "Frame rate",
      <span key="v" className="data">{`${formatFps(video.fps)} fps`}</span>,
    ]);
  }
  items.push([
    "File",
    <span key="v" className="break-all">
      {video.fileName} · <span className="data">{formatSize(video.sizeBytes)}</span>
    </span>,
  ]);
  if (video.uploadedAt) {
    items.push([
      "Uploaded",
      <span key="v" className="data">
        {formatDateTime(video.uploadedAt)}
      </span>,
    ]);
  }
  if (video.deletedAt) {
    items.push([
      "Raw footage deleted",
      <span key="v" className="data">
        Deleted
      </span>,
    ]);
  } else if (expires) {
    const left = expires.getTime() - now.getTime();
    items.push([
      "Raw footage deleted",
      <span key="v" className="data">
        {left > 0 ? `${formatDeletionDate(expires)}, in ${formatTimeLeft(left)}` : "Deleted"}
      </span>,
    ]);
  }
  return <FactList items={items} />;
}

function matchStatusText(match: MatchDetail, now: Date): string | null {
  switch (match.status) {
    case "processing": {
      const ready = match.video && estimatedReadyAt(match.video);
      return ready && ready.getTime() > now.getTime()
        ? `Processing. Ready for review by about ${formatReadyBy(ready, now)}.`
        : "Processing is taking longer than usual. This page updates when it is ready.";
    }
    case "awaiting_review":
      return "Ready for review. A scout picks it up from the review queue.";
    case "in_review":
      return "A scout is reviewing this match.";
    case "published":
      return "Published. Stats from this match are on player profiles.";
    case "failed":
      return "Processing failed. Wideline staff have been told and will try again.";
    default:
      return null;
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function sideText(c: SideCounts): string | null {
  if (c.starters + c.substitutes === 0) return null;
  return `${plural(c.starters, "starter", "starters")} · ${plural(c.substitutes, "substitute", "substitutes")} · ${plural(c.substitutions, "substitution", "substitutions")}`;
}

/**
 * One match (MATCH05, MATCH07, MATCH08; docs/build/design/C06.md, Surface 6):
 * where it is, what to do next, the footage check, lineups and markers, and
 * delete for owners and admins. Another organisation's match is not found.
 */
export default async function MatchPage({ params, searchParams }: Props) {
  const ctx = requireSquadOrgPage(await requirePageRole(CLUB_ROLES));
  const match = await loadMatch(ctx, (await params).matchId);
  if (!match) notFound();
  const done = doneMessage(DONE, (await searchParams)?.done);
  const now = new Date();
  const video = shownVideo(match);
  const fixture = fixtureText(match);
  const locked = isLocked(match.status);
  const accepted = video?.status === "accepted";
  const limit = await limitFor(ctx.organisationId, "upload_max_bytes");

  let uploadPercent: number | null = null;
  if (video?.status === "uploading") {
    try {
      const info = await uploadStatus(ctx, match.id);
      if (info && info.sizeBytes > 0) {
        uploadPercent = Math.floor((info.uploadedBytes / info.sizeBytes) * 100);
      }
    } catch (err) {
      log.warn({ err, matchId: match.id }, "upload progress unavailable");
    }
  }

  const ownSides = (["home", "away"] as const).filter(
    (s) => !(s === "home" ? match.homeTeam : match.awayTeam).isOpposition,
  );
  const lineupMissing = ownSides.some((s) => sideText(match.lineups[s]) === null);
  const markersMissing = !!video && MARKER_KEYS.some((k) => video.markers[k] === null);

  let primary: ReactNode = null;
  if (match.status === "draft" && (!video || video.status === "rejected")) {
    primary = (
      <ButtonLink variant="primary" block icon={Upload} href={`/matches/${match.id}/upload`}>
        Upload footage
      </ButtonLink>
    );
  } else if (match.status === "uploading" && video?.status === "uploading") {
    primary = (
      <ButtonLink variant="primary" block icon={Upload} href={`/matches/${match.id}/upload`}>
        Carry on uploading
      </ButtonLink>
    );
  } else if (accepted && !locked && lineupMissing) {
    primary = (
      <ButtonLink variant="primary" block icon={Users} href={`/matches/${match.id}/lineup`}>
        Enter lineups
      </ButtonLink>
    );
  } else if (accepted && !locked && markersMissing) {
    primary = (
      <ButtonLink variant="primary" block icon={Flag} href={`/matches/${match.id}/markers`}>
        Set kickoff and half-time
      </ButtonLink>
    );
  }

  const soon = expiresSoon(video, now);
  const issues = video?.validation?.issues ?? [];
  const warnings = issues.filter((i) => i.severity === "warn");

  let footage: ReactNode;
  if (!video) {
    footage = (
      <p className="body">
        No footage yet. Upload the whole match from your wide-angle camera: MP4 or MOV, up to{" "}
        {formatGB(limit)}.
      </p>
    );
  } else if (video.status === "uploading") {
    footage = (
      <>
        <p className="body">
          {uploadPercent !== null
            ? `Upload in progress: ${uploadPercent}% of ${formatSize(video.sizeBytes)}.`
            : `Upload in progress: ${formatSize(video.sizeBytes)}.`}
        </p>
        <p className="caption mt-2 text-ink-muted">
          The upload runs in the browser that started it. Open the upload page and choose the same
          file to carry on.
        </p>
      </>
    );
  } else if (video.status === "probing") {
    footage = (
      <p className="body">We are checking the footage. This usually takes a minute or two.</p>
    );
  } else if (video.status === "rejected") {
    footage = (
      <>
        <Banner tone="danger">This footage cannot be used.</Banner>
        <IssueList issues={issues} />
        {video.rawExpiresAt && !video.deletedAt && (
          <p className="caption mt-4 text-ink-muted">
            We keep the rejected file until {formatDeletionDate(video.rawExpiresAt)}, then delete
            it.
          </p>
        )}
      </>
    );
  } else {
    const statusText = matchStatusText(match, now);
    footage = (
      <>
        {warnings.length > 0 && (
          <>
            <Banner tone="warn">
              {`Footage accepted with ${plural(warnings.length, "warning", "warnings")}. We will still process it.`}
            </Banner>
            <IssueList issues={warnings} />
          </>
        )}
        <FootageFacts video={video} now={now} />
        {statusText && <p className="body mt-4">{statusText}</p>}
      </>
    );
  }

  const sides = (["home", "away"] as const).map((s) => ({
    side: s,
    team: s === "home" ? match.homeTeam : match.awayTeam,
    text: sideText(match.lineups[s]),
  }));
  const anyLineup = sides.some((s) => s.text !== null);

  const sections: DetailSection[] = [
    {
      id: "footage",
      title: "Footage",
      content: (
        <div className="wl-card max-w-3xl">
          <div aria-live="polite">
            {video && (
              <div className="wl-row mb-4">
                <FootageChip state={footageState(video)} />
              </div>
            )}
            {footage}
          </div>
        </div>
      ),
    },
    {
      id: "lineups",
      title: "Lineups",
      content: (
        <div className="max-w-3xl">
          <ul className="wl-stack" role="list">
            {sides.map((s) => (
              <li key={s.side} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <TeamMarker side={s.side} name={s.team.name} />
                {s.text ? (
                  <span className="body">{s.text}</span>
                ) : (
                  <span className="body text-ink-muted">Not entered yet</span>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <ButtonLink variant="secondary" size="sm" href={`/matches/${match.id}/lineup`}>
              {locked ? "View lineups" : anyLineup ? "Edit lineups" : "Enter lineups"}
            </ButtonLink>
          </div>
        </div>
      ),
    },
    {
      id: "markers",
      title: "Kickoff and half-time",
      content: !accepted ? (
        <p className="body max-w-3xl text-ink-muted">
          You can set these once the footage is accepted.
        </p>
      ) : (
        <div className="max-w-3xl">
          <FactList
            items={MARKER_KEYS.map((k) => {
              const ms = video.markers[k];
              return [
                MARKER_LABELS[k],
                ms === null ? (
                  <span className="text-ink-muted">Not set</span>
                ) : (
                  <span className="data">{formatVideoTime(ms, 0)}</span>
                ),
              ];
            })}
          />
          {!locked && (
            <div className="mt-4">
              <ButtonLink variant="secondary" size="sm" href={`/matches/${match.id}/markers`}>
                {markersMissing && MARKER_KEYS.every((k) => video.markers[k] === null)
                  ? "Set markers"
                  : "Change markers"}
              </ButtonLink>
            </div>
          )}
        </div>
      ),
    },
    {
      id: "delete",
      title: "Delete match",
      content: canDeleteMatch(ctx.roles) ? (
        <div className="max-w-3xl">
          <p className="body text-ink-muted">
            Deleting a match removes its lineups, markers and everything worked out from them, such
            as stats and clips. The footage file is kept until 7 days after upload, then deleted.
          </p>
          <div className="mt-4">
            <DeleteMatch
              matchId={match.id}
              fixture={fixture}
              date={formatDate(match.playedAt)}
              uploading={video?.status === "uploading"}
            />
          </div>
        </div>
      ) : (
        <p className="body max-w-3xl text-ink-muted">Only owners and admins can delete a match.</p>
      ),
    },
  ];

  const pollEvery =
    video?.status === "probing" ? 10_000 : match.status === "processing" ? 30_000 : null;

  return (
    <>
      {pollEvery && <StatusPoller everyMs={pollEvery} />}
      <DetailPage
        back={{ href: "/matches", label: "Matches" }}
        eyebrow={match.competition ?? "Match"}
        title={fixture}
        meta={metaText([
          formatMatchDate(match.playedAt),
          match.venue,
          `2 × ${match.halfLengthMinutes} min`,
        ])}
        badges={
          <>
            <MatchStatusChip status={match.status} />
            {video && (match.status === "draft" || match.status === "uploading") && (
              <FootageChip state={footageState(video)} />
            )}
            {soon && <ExpiryLabel expiresAt={soon} now={now} />}
          </>
        }
        actions={
          <>
            {primary}
            <ButtonLink
              variant="secondary"
              size="sm"
              block
              icon={Pencil}
              href={`/matches/${match.id}/edit`}
            >
              Edit match
            </ButtonLink>
          </>
        }
        notice={
          <>
            <div aria-live="polite" className="mt-6 empty:mt-0">
              {done && <Banner tone="ok">{done}</Banner>}
            </div>
            {soon && (
              <div className="mt-6">
                <ExpiryBanner expiresAt={soon} now={now}>
                  After that, nobody can review this match again or add missed events. Stats already
                  confirmed are kept.
                </ExpiryBanner>
              </div>
            )}
          </>
        }
        sections={sections}
      />
    </>
  );
}
