import { Clock, Flag, Pencil, Upload, Users } from "lucide-react";
import { notFound } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import { Banner } from "@/components/forms";
import { BackLinkButton } from "@/components/templates/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { formatDeletionDate } from "@/components/ui/expiry";
import { ExpiryBanner, ExpiryLabel } from "@/components/ui/ExpiryBanner";
import { ExpiryChip } from "@/components/ui/ExpiryChip";
import { iconProps } from "@/components/ui/icons";
import { FootageChip, MatchStatusChip } from "@/components/ui/StatusChip";
import { Tabs } from "@/components/ui/Tabs";
import { TeamMarker } from "@/components/ui/TeamMarker";
import { HlsPlayer, type PlayerCaptions } from "@/components/video/HlsPlayer";
import { PlayerShortcuts } from "@/components/video/PlayerShortcuts";
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
import { playableVideo } from "@/server/matches/playback";
import { uploadStatus } from "@/server/matches/upload";
import { processingSummary, type ProcessingSummary } from "@/server/processing/summary";
import { metaText } from "../../squad/shared";
import {
  doneMessage,
  expiresSoon,
  footageState,
  IssueList,
  opponentText,
  ownSide,
  rawExpiry,
} from "../shared";
import { DeleteMatch } from "./DeleteMatch";
import { loadMatch } from "./load";
import { jobRows, PipelineSteps, type PipelineRow } from "./ProcessingPanel";
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

/** A hairline panel (Floodlight: flat, no shadow). */
function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("border border-line bg-panel", className)}>{children}</div>;
}

/** A panel head in heading-section caps with an ink underline ("Match facts"). */
function PanelHead({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink px-4 py-3.5">
      <h3 className="font-display text-heading-section stretch-wide uppercase">{title}</h3>
      {aside}
    </div>
  );
}

/** Label and value rows, the value in mono (Screens A, "Match facts"). */
function FactList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="m-0">
      {items.map(([label, value]) => (
        <Fragment key={label}>
          <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-b border-line px-4 py-2.5 text-body-s leading-snug last:border-b-0">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="m-0 min-w-0 font-mono text-body-s break-words tabular-nums">{value}</dd>
          </div>
        </Fragment>
      ))}
    </dl>
  );
}

function recordingText(video: VideoSummary): string {
  return [
    video.durationSec !== null ? formatFootageLength(video.durationSec) : null,
    video.width !== null && video.height !== null ? `${video.width} × ${video.height}` : null,
    formatSize(video.sizeBytes),
  ]
    .filter(Boolean)
    .join(" · ");
}

function footageFacts(video: VideoSummary): [string, ReactNode][] {
  const items: [string, ReactNode][] = [["Recording", recordingText(video)]];
  if (video.fps !== null) items.push(["Frame rate", `${formatFps(video.fps)} fps`]);
  items.push([
    "File",
    <span key="v" className="break-all">
      {video.fileName}
    </span>,
  ]);
  if (video.uploadedAt) items.push(["Uploaded", formatDateTime(video.uploadedAt)]);
  return items;
}

/** The footage row of the facts panel: the expiry chip plus the date in words. */
function FootageExpiry({ video, now }: { video: VideoSummary; now: Date }) {
  const expires = rawExpiry(video);
  if (video.deletedAt || (video.rawExpiresAt && !expires)) {
    return (
      <span className="flex flex-col items-start gap-1.5">
        {video.rawExpiresAt && <ExpiryChip deletesAt={video.rawExpiresAt} now={now} deleted />}
        <span className="font-ui text-body-s text-ink-muted">Raw footage deleted</span>
      </span>
    );
  }
  if (!expires) return <span className="text-ink-muted">–</span>;
  const left = expires.getTime() - now.getTime();
  return (
    <span className="flex flex-col items-start gap-1.5">
      <ExpiryChip deletesAt={expires} now={now} />
      <span className="font-ui text-body-s text-ink-muted">
        {left > 0 ? `Raw footage kept until ${formatDeletionDate(expires)}` : "Raw footage deleted"}
      </span>
    </span>
  );
}

/**
 * `reviewDueAt` is the live review claim's end (C10), or null: an In review
 * match whose claim has run out is about to go back to the queue, so it reads
 * as Awaiting review. The scout is never named (Q-059).
 */
function matchStatusText(
  match: MatchDetail,
  now: Date,
  readyAt?: Date | null,
  reviewDueAt: Date | null = null,
): string | null {
  switch (match.status) {
    case "processing": {
      // C07: readyAt uses measured transcode timings; the C06 constants otherwise.
      const ready = readyAt !== undefined ? readyAt : match.video && estimatedReadyAt(match.video);
      return ready && ready.getTime() > now.getTime()
        ? `Processing. Ready for review by about ${formatReadyBy(ready, now)}.`
        : "Processing is taking longer than usual. This page updates when it is ready.";
    }
    case "awaiting_review":
      return READY_FOR_REVIEW;
    case "in_review":
      return reviewDueAt
        ? `A scout is reviewing this match. The review is due by ${formatReadyBy(reviewDueAt, now)}.`
        : READY_FOR_REVIEW;
    case "published":
      return "Published. Stats from this match are on player profiles.";
    case "failed":
      return "Processing failed. Wideline staff have been told and will try again.";
    default:
      return null;
  }
}

const READY_FOR_REVIEW = "Ready for review. A scout picks it up from the review queue.";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function sideText(c: SideCounts): string | null {
  if (c.starters + c.substitutes === 0) return null;
  return `${plural(c.starters, "starter", "starters")} · ${plural(c.substitutes, "substitute", "substitutes")} · ${plural(c.substitutions, "substitution", "substitutions")}`;
}

/** "while preparing playback": the step a failed match stopped at, in words. */
const STOPPED_WHILE: Record<string, string> = {
  "Preparing playback": "while preparing playback",
  "Finding events": "while finding events",
  "Cutting clips": "while cutting clips",
};

/**
 * One match (MATCH05, MATCH07, MATCH08; docs/build/design/C06.md, Surface 6; Floodlight
 * Screens A, "Match detail"): where it is, what to do next, the footage check, lineups and
 * markers, and delete for owners and admins. Another organisation's match is not found.
 * While processing: six named steps, only the running one with a lime bar, and an
 * estimate. Failed: which step stopped, why, and what will help.
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

  // C07: processing steps and the estimate, while Processing or Failed (C08:
  // the CV job's step too).
  let processing: ProcessingSummary | null | "unavailable" = null;
  if (accepted && (match.status === "processing" || match.status === "failed")) {
    try {
      processing = await processingSummary(ctx, match.id);
    } catch (err) {
      log.warn({ err, matchId: match.id }, "processing status unavailable");
      processing = "unavailable";
    }
  }
  const playable = accepted && !video.deletedAt ? await playableVideo(ctx, match.id) : null;

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

  // C10: the live claim's end, read through the scoped client (claims are
  // readable there, never writable). Only the time, never the scout.
  const claim =
    accepted && match.status === "in_review"
      ? await ctx.db.reviewClaim.findFirst({
          where: { matchId: match.id, status: "active", expiresAt: { gt: now } },
          select: { expiresAt: true },
        })
      : null;
  const readyAt = processing && processing !== "unavailable" ? processing.readyAt : undefined;
  const statusText = accepted
    ? matchStatusText(match, now, readyAt, claim?.expiresAt ?? null)
    : null;

  // The six named steps (Screens A): the recording, the club's lineup and markers, the
  // three jobs, then the review queue.
  let pipeline: PipelineRow[] | null = null;
  if (accepted && processing && processing !== "unavailable") {
    const setupMissing = lineupMissing || markersMissing;
    const reviewed = ["awaiting_review", "in_review", "published"].includes(match.status);
    pipeline = [
      {
        name: "Recording received",
        state: "Done",
        caption: [
          formatSize(video.sizeBytes),
          video.durationSec !== null ? formatFootageLength(video.durationSec) : null,
        ]
          .filter(Boolean)
          .join(" · "),
        status: "done",
      },
      {
        name: "Lineup and markers",
        state: setupMissing ? "Waiting for you" : "Done",
        caption: lineupMissing
          ? "Enter the lineups."
          : markersMissing
            ? "Set kickoff and half-time."
            : "Lineups entered and markers set.",
        status: setupMissing ? "person" : "done",
      },
      ...jobRows(processing),
      {
        name: "Ready for review",
        state: reviewed ? "Done" : "Not yet",
        caption: "Joins the review queue.",
        status: reviewed ? "done" : "waiting",
      },
    ];
  }

  // Accepted with warnings: shown in every accepted state, processing and failed too.
  const warningsBlock =
    accepted && warnings.length > 0 ? (
      <div className="border-b border-line px-5 py-4 touch:px-4">
        <Banner tone="warn">
          {`Footage accepted with ${plural(warnings.length, "warning", "warnings")}. We will still process it.`}
        </Banner>
        <IssueList issues={warnings} />
      </div>
    ) : null;
  const kept = rawExpiry(video);

  let main: ReactNode;
  if (!video) {
    main = (
      <div className="px-5 py-4">
        <p>
          No footage yet. Upload the whole match from your wide-angle camera: MP4 or MOV, up to{" "}
          {formatGB(limit)}.
        </p>
      </div>
    );
  } else if (video.status === "uploading") {
    main = (
      <div className="flex flex-col gap-2 px-5 py-4">
        <p className="tabular-nums">
          {uploadPercent !== null
            ? `Upload in progress: ${uploadPercent}% of ${formatSize(video.sizeBytes)}.`
            : `Upload in progress: ${formatSize(video.sizeBytes)}.`}
        </p>
        {uploadPercent !== null && (
          <span aria-hidden className="block h-1.5 bg-selected">
            <span
              className="block h-full border border-brand-edge bg-brand"
              style={{ width: `${uploadPercent}%` }}
            />
          </span>
        )}
        <p className="text-body-s text-ink-muted">
          The upload runs in the browser that started it. Open the upload page and choose the same
          file to carry on.
        </p>
      </div>
    );
  } else if (video.status === "probing") {
    main = (
      <div className="px-5 py-4">
        <p>We are checking the footage. This usually takes a minute or two.</p>
      </div>
    );
  } else if (video.status === "rejected") {
    main = (
      <div className="px-5 py-4">
        <Banner tone="danger">This footage cannot be used.</Banner>
        <IssueList issues={issues} />
        {video.rawExpiresAt && !video.deletedAt && (
          <p className="mt-4 text-body-s text-ink-muted">
            We keep the rejected file until {formatDeletionDate(video.rawExpiresAt)}, then delete
            it.
          </p>
        )}
      </div>
    );
  } else if (match.status === "failed" && pipeline) {
    const stoppedAt = pipeline.findIndex((r) => r.status === "failed");
    const stopped = stoppedAt >= 0 ? pipeline[stoppedAt]! : null;
    main = (
      <>
        {warningsBlock}
        <div className="flex flex-col gap-1.5 border-b border-line px-5 py-3.5 touch:px-4">
          <h3 className="text-title-m">
            Processing stopped {stopped ? (STOPPED_WHILE[stopped.name] ?? "") : ""}
          </h3>
          {stopped && (
            <span className="font-mono text-body-s text-ink-muted tabular-nums">
              Step {stoppedAt + 1} of {pipeline.length}
            </span>
          )}
        </div>
        <p className="border-b border-line px-5 py-3.5 text-pretty touch:px-4">
          {stopped?.caption ??
            "Processing failed. Wideline staff have been told and will try again."}
        </p>
        <div className="flex flex-col gap-2.5 border-b border-line px-5 py-3.5 touch:px-4">
          <span className="text-label">What you can do</span>
          <ol role="list" className="flex flex-col gap-2">
            <li className="flex gap-2.5">
              <span className="font-mono font-semibold text-ink-muted">1</span>
              Wait for Wideline staff to try again. This page updates when they do.
            </li>
            <li className="flex gap-2.5">
              <span className="font-mono font-semibold text-ink-muted">2</span>
              To use a different recording, an owner or admin deletes the match and you create it
              again.
            </li>
          </ol>
        </div>
        {kept && (
          <p className="flex items-center gap-2 border-b border-line px-5 py-3.5 text-ink-muted touch:px-4">
            <Clock {...iconProps} className="shrink-0" />
            The recording is kept until {formatDeletionDate(kept)}.
          </p>
        )}
        <PipelineSteps rows={pipeline} />
      </>
    );
  } else if (pipeline) {
    const current = pipeline.findIndex((r) => r.status !== "done");
    const ready = readyAt ?? (match.video && estimatedReadyAt(match.video));
    main = (
      <>
        {warningsBlock}
        <div className="flex flex-col gap-3.5 border-b border-line px-5 py-4.5 touch:px-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-title-m">Processing the recording</h3>
            {ready && ready.getTime() > now.getTime() && (
              <span className="font-mono text-mono-m font-semibold tabular-nums">
                ready by about {formatReadyBy(ready, now)}
              </span>
            )}
          </div>
          <p className="text-ink-muted">
            {current >= 0 && `Step ${current + 1} of ${pipeline.length}. `}
            You can leave this page. When the match is ready it joins the review queue.
          </p>
        </div>
        <PipelineSteps rows={pipeline} />
      </>
    );
  } else {
    main = (
      <>
        {warningsBlock}
        {(processing === "unavailable" || statusText) && (
          <div className="px-5 py-4 touch:px-4">
            {processing === "unavailable" && (
              <p className="mb-3 text-ink-muted">
                Processing status is not available right now. This page updates every 30 seconds.
              </p>
            )}
            {statusText && <p>{statusText}</p>}
          </div>
        )}
      </>
    );
  }

  const facts: [string, ReactNode][] = video ? footageFacts(video) : [];
  for (const s of (["home", "away"] as const).filter((x) => ownSides.includes(x))) {
    const text = sideText(match.lineups[s]);
    facts.push([
      ownSides.length > 1 ? `Lineup (${s})` : "Lineup",
      text ?? <span className="font-ui text-ink-muted">Not entered yet</span>,
    ]);
  }
  if (accepted) {
    for (const k of MARKER_KEYS) {
      const ms = video.markers[k];
      facts.push([
        MARKER_LABELS[k],
        ms === null ? (
          <span className="font-ui text-ink-muted">Not set</span>
        ) : (
          `video ${formatVideoTime(ms, 0)}`
        ),
      ]);
    }
  }
  if (video) facts.push(["Footage", <FootageExpiry key="f" video={video} now={now} />]);

  const sides = (["home", "away"] as const).map((s) => ({
    side: s,
    team: s === "home" ? match.homeTeam : match.awayTeam,
    text: sideText(match.lineups[s]),
  }));
  const anyLineup = sides.some((s) => s.text !== null);
  const lineupCount = sides.reduce(
    (n, s) => n + match.lineups[s.side].starters + match.lineups[s.side].substitutes,
    0,
  );

  const transcodeFailed =
    match.status === "failed" ||
    (processing !== null &&
      processing !== "unavailable" &&
      processing.transcode?.status === "failed");
  const muted = (text: string) => <p className="max-w-3xl text-ink-muted">{text}</p>;
  let watch: ReactNode;
  if (!accepted) {
    watch = muted("You can watch the match here once the footage is accepted.");
  } else if (video.deletedAt) {
    watch = muted(
      "The footage for this match has been deleted. Footage is kept for 7 days after upload.",
    );
  } else if (playable) {
    // v0 generates no captions; WebVTT tracks go here when it does.
    const captions: PlayerCaptions = [];
    watch = (
      <>
        <HlsPlayer
          source={{ kind: "hls", url: `/api/matches/${match.id}/hls/master.m3u8` }}
          title={`Match video: ${fixture}`}
          keyboard="own"
          captions={captions}
        />
        <PlayerShortcuts captions={captions.length > 0} />
        <p className="mt-2 text-body-s text-ink-muted">
          Only people in your club with access to matches can watch. Footage is deleted 7 days after
          upload.
        </p>
      </>
    );
  } else if (transcodeFailed) {
    watch = muted(
      "Playback is not available because processing failed. Wideline staff have been told.",
    );
  } else {
    watch = muted("Playback is ready once processing has prepared the video.");
  }

  const sections: { id: string; title: string; content: ReactNode }[] = [
    {
      id: "footage",
      title: "Footage",
      content: (
        <div className="grid items-start gap-6 desktop:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
          <Panel>
            <div aria-live="polite">{main}</div>
          </Panel>
          {facts.length > 0 && (
            <Panel>
              <PanelHead
                title="Match facts"
                aside={video ? <FootageChip state={footageState(video)} /> : undefined}
              />
              <FactList items={facts} />
            </Panel>
          )}
        </div>
      ),
    },
    { id: "watch", title: "Watch", content: watch },
    {
      id: "lineups",
      title: "Lineups",
      content: (
        <div className="max-w-3xl">
          <ul className="flex flex-col border border-line bg-panel" role="list">
            {sides.map((s) => (
              <li
                key={s.side}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3 last:border-b-0"
              >
                <TeamMarker side={s.side} name={s.team.name} />
                {s.text ? (
                  <span className="tabular-nums">{s.text}</span>
                ) : (
                  <span className="text-ink-muted">Not entered yet</span>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <ButtonLink
              variant="secondary"
              size="s"
              icon={Pencil}
              className="touch:h-control-l"
              href={`/matches/${match.id}/lineup`}
            >
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
        <p className="max-w-3xl text-ink-muted">You can set these once the footage is accepted.</p>
      ) : (
        <div className="max-w-3xl">
          <Panel>
            <FactList
              items={MARKER_KEYS.map((k) => {
                const ms = video.markers[k];
                return [
                  MARKER_LABELS[k],
                  ms === null ? (
                    <span className="font-ui text-ink-muted">Not set</span>
                  ) : (
                    formatVideoTime(ms, 0)
                  ),
                ];
              })}
            />
          </Panel>
          {!locked && (
            <div className="mt-4">
              <ButtonLink
                variant="secondary"
                size="s"
                icon={Clock}
                className="touch:h-control-l"
                href={`/matches/${match.id}/markers`}
              >
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
          <p className="text-ink-muted">
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
        <p className="max-w-3xl text-ink-muted">Only owners and admins can delete a match.</p>
      ),
    },
  ];

  const pollEvery =
    video?.status === "probing" ? 10_000 : match.status === "processing" ? 30_000 : null;

  const side = ownSide(match);
  const meta = metaText([
    formatMatchDate(match.playedAt),
    match.competition,
    side,
    match.venue,
    `2 × ${match.halfLengthMinutes} min`,
  ]);

  return (
    <>
      {pollEvery && <StatusPoller everyMs={pollEvery} />}
      <div className="mb-4">
        <BackLinkButton href="/matches" label="Matches" />
      </div>
      {/* Screens A, "Match detail · processing": status first, the fixture in caps with H and
          A markers, a mono meta line, then the tabs, all in one panel. Phones show the
          club's side only ("Match detail · phone failed"). */}
      <header
        aria-labelledby="match-title"
        className="flex flex-col gap-3.5 border border-line bg-panel px-7 pt-6 touch:gap-4 touch:px-4 touch:pt-5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <MatchStatusChip status={match.status} />
          {video && (match.status === "draft" || match.status === "uploading") && (
            <FootageChip state={footageState(video)} />
          )}
          {soon && <ExpiryLabel expiresAt={soon} now={now} />}
        </div>
        <div className="flex flex-col gap-4 desktop:flex-row desktop:items-start desktop:justify-between desktop:gap-6">
          <div className="flex min-w-0 flex-col gap-3.5 touch:gap-2.5">
            <h1
              id="match-title"
              className="m-0 font-display text-display-phone break-words stretch-wide uppercase touch:text-stat-m touch:font-extrabold"
            >
              <span className="flex flex-wrap items-center gap-3.5 touch:hidden">
                <HeroMarker side="home" />
                {match.homeTeam.name}
                <span className="font-mono text-mono-l font-normal text-ink-muted normal-case">
                  v
                </span>
                <HeroMarker side="away" />
                {match.awayTeam.name}
              </span>
              <span className="hidden items-center gap-2.5 touch:flex">
                <TeamMarker side={side} size={24} className="shrink-0" />
                <span className="min-w-0">
                  <span className="sr-only">
                    {(side === "home" ? match.homeTeam : match.awayTeam).name}{" "}
                  </span>
                  {opponentText(match)}
                </span>
              </span>
            </h1>
            {meta && (
              <p className="m-0 font-mono text-body-s font-medium text-ink-muted tabular-nums">
                {meta}
              </p>
            )}
          </div>
          <div className="wl-row shrink-0">
            {primary}
            <ButtonLink variant="secondary" block icon={Pencil} href={`/matches/${match.id}/edit`}>
              Edit match
            </ButtonLink>
          </div>
        </div>
        <Tabs
          aria-label="Match"
          value="overview"
          className="shadow-none"
          items={[
            { value: "overview", label: "Overview", href: `/matches/${match.id}` },
            {
              value: "lineup",
              label: "Lineup",
              count: lineupCount,
              href: `/matches/${match.id}/lineup`,
            },
            {
              value: "events",
              label: "Events",
              // Disabled until the review is published; the reason sits beside the label.
              count: match.status === "published" ? undefined : "after review",
              href: `/matches/${match.id}`,
              disabled: match.status !== "published",
            },
            { value: "footage", label: "Footage", href: `/matches/${match.id}#watch` },
          ]}
        />
      </header>
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
      {sections.map((s) => (
        <section key={s.id} aria-labelledby={s.id} className="mt-8 touch:mt-6">
          <h2
            id={s.id}
            tabIndex={-1}
            className="wl-section-title scroll-mt-[var(--wl-shell-topbar)]"
          >
            {s.title}
          </h2>
          <div className="mt-4">{s.content}</div>
        </section>
      ))}
    </>
  );
}

/**
 * The 28px H / A square of the match header (Screens A, "Match detail · processing"). The
 * core TeamMarker has no 28px size, so this draws the same square from tokens.
 */
function HeroMarker({ side }: { side: "home" | "away" }) {
  const home = side === "home";
  return (
    <span
      role="img"
      aria-label={home ? "Home side" : "Away side"}
      className={cx(
        "grid size-7 shrink-0 place-items-center rounded-control font-display text-heading-section font-extrabold stretch-wide",
        home ? "bg-home text-on-home" : "bg-away text-on-away",
      )}
    >
      <span aria-hidden>{home ? "H" : "A"}</span>
    </span>
  );
}
