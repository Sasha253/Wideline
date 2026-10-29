import { Check, Clock, Crosshair, ExternalLink, Trash2, TriangleAlert } from "lucide-react";
import { notFound } from "next/navigation";
import { Banner } from "@/components/forms";
import { EmptyState } from "@/components/states/EmptyState";
import { DataTable, Missing } from "@/components/templates/DataTable";
import { DetailPage } from "@/components/templates/DetailPage";
import { ButtonLink } from "@/components/ui/Button";
import { ConfidenceMeter } from "@/components/ui/ConfidenceMeter";
import { iconProps } from "@/components/ui/icons";
import {
  EventStatusChip,
  FootageChip,
  JobStatusChip,
  MatchStatusChip,
  type EventReviewState,
  type FootageState,
} from "@/components/ui/StatusChip";
import { TeamMarker } from "@/components/ui/TeamMarker";
import {
  formatCount,
  formatDateTime,
  formatEta,
  formatMatchDate,
  formatSize,
  formatVideoTime,
} from "@/lib/labels";
import { LAB_ROLES, requirePageRole } from "@/server/auth/session";
import {
  isSynthetic,
  matchBenchmark,
  versionParts,
  type LabJob,
  type MatchBenchmark,
} from "@/server/lab/benchmark";
import { nearest, type Detection, type RecallRow, type Tag } from "@/server/lab/recall";
import { REVIEW_READY_TARGET_SEC } from "@/server/lab/timings";
import { JobAttempt, RecallTable, SyntheticChip, ToleranceNote } from "../../lab-ui";
import { FocusHeadingOnMount } from "../../../squad/FocusOnMount";
import { ImportTagsForm } from "./ImportTagsForm";

export const metadata = { title: "Match benchmark" };

// The match benchmark view (docs/build/design/C09.md, Surface 3): recall per
// event type against the hand tags, the missed tags and unmatched detections,
// the run's facts, and the tag import.

const LIST_CAP = 100;

type Kind = "goal" | "shot" | "touch";

function kindLabel(type: Kind, onTarget: boolean | null): string {
  if (type === "goal") return "Goal";
  if (type === "touch") return "Touch";
  return onTarget ? "Shot on target" : "Shot";
}

function Side({ side, b }: { side: string | null | undefined; b: MatchBenchmark }) {
  if (side === "home") return <TeamMarker side="home" name={b.match.homeTeamName} />;
  if (side === "away") return <TeamMarker side="away" name={b.match.awayTeamName} />;
  return <Missing />;
}

function footageState(b: MatchBenchmark): FootageState | null {
  const v = b.video;
  if (!v) return null;
  if (v.status === "accepted" && v.validation?.verdict === "accepted_with_warnings") {
    return "accepted_with_warnings";
  }
  return v.status;
}

function RecallSection({ b }: { b: MatchBenchmark }) {
  const hasTags = b.tags.length > 0;
  if (!b.measured && !hasTags) {
    return (
      <EmptyState
        art={false}
        title="Nothing to measure yet"
        body="Recall needs a finished CV run and hand tags for this match."
      />
    );
  }
  if (!hasTags) {
    return (
      <EmptyState
        art={false}
        title="No tags yet"
        body="Import hand-tagged events to measure recall for this match."
        action={
          <a href="#import" className="body wl-link-row text-pitch underline">
            Go to Import tags
          </a>
        }
      />
    );
  }
  if (!b.recall) {
    const rows: RecallRow[] = (["goal", "shot", "shot_on_target", "touch"] as const).map(
      (type) => ({
        type,
        tagged: b.tags.filter(
          (t) =>
            t.type === (type === "shot_on_target" ? "shot" : type) &&
            (type !== "shot_on_target" || t.onTarget === true),
        ).length,
        detected: 0,
        matched: 0,
        autoMatched: 0,
      }),
    );
    return (
      <>
        <p className="body mb-3 text-ink-muted">Recall appears once the CV job has finished.</p>
        <RecallTable caption="Recall by event type" rows={rows} notYet />
      </>
    );
  }
  const latestFailed = b.cv?.status === "failed" && b.measured && b.measured.id !== b.cv.id;
  return (
    <>
      {latestFailed && b.measured?.finishedAt && (
        <div className="mb-3">
          <Banner tone="warn">
            The latest CV run failed. These numbers are from the run on{" "}
            {formatDateTime(b.measured.finishedAt)}.
          </Banner>
        </div>
      )}
      <RecallTable caption="Recall by event type" rows={b.recall.rows} />
      <ToleranceNote thresholds={b.thresholds} />
    </>
  );
}

function MissedSection({ b }: { b: MatchBenchmark }) {
  const missed = b.recall!.missed;
  if (missed.length === 0) {
    return (
      <p className="body">
        <span className="wl-inline-status wl-inline-status--ok">
          <Check {...iconProps} />
          Every tag was found.
        </span>
      </p>
    );
  }
  const shown = missed.slice(0, LIST_CAP);
  const near = (t: Tag) => {
    const d = nearest(t, b.detections);
    if (!d) return null;
    const gap = Math.abs(d.timestampMs - t.timestampMs) / 1000;
    return `${formatVideoTime(d.timestampMs, 1)} · ${gap.toFixed(1)} s away`;
  };
  const tagSide = (t: Tag) => b.tags.find((x) => x.id === t.id)?.teamSide ?? null;
  return (
    <>
      <p className="body mb-3 text-ink-muted">Hand tags the pipeline did not find.</p>
      <DataTable
        caption="Missed tags, goals and shots first"
        columns={[
          { id: "time", header: "Video time" },
          { id: "type", header: "Event" },
          { id: "side", header: "Side" },
          { id: "nearest", header: "Nearest detection", numeric: true },
        ]}
        rows={shown.map((t) => ({
          id: t.id,
          cells: [
            <span key="time" className="data tabular-nums">
              {formatVideoTime(t.timestampMs, 1)}
            </span>,
            <span key="type">{kindLabel(t.type, t.onTarget)}</span>,
            <Side key="side" side={tagSide(t)} b={b} />,
            near(t) ?? <Missing key="n" />,
          ],
        }))}
        cards={shown.map((t) => (
          <li key={t.id} className="wl-card flex flex-col gap-2">
            <div className="wl-row">
              <span className="data tabular-nums">{formatVideoTime(t.timestampMs, 1)}</span>
              <span className="body-strong">{kindLabel(t.type, t.onTarget)}</span>
              <Side side={tagSide(t)} b={b} />
            </div>
            <p className="caption text-ink-muted">{near(t) ?? <Missing />}</p>
          </li>
        ))}
      />
      {missed.length > LIST_CAP && (
        <p className="caption mt-3 text-ink-muted">
          Showing the first 100 of {formatCount(missed.length)} missed tags.
        </p>
      )}
    </>
  );
}

function ClipCell({ b, d }: { b: MatchBenchmark; d: Detection }) {
  const clip = b.clipsByEvent.get(d.id);
  if (clip?.deletedAt) return <span className="text-ink-muted">Clip deleted</span>;
  if (clip) {
    const what = kindLabel(d.type, d.onTarget);
    return (
      <a
        href={`/lab/clips/${clip.id}`}
        target="_blank"
        rel="noopener"
        className="body wl-link-row text-pitch underline"
        aria-label={`Open clip of ${what} at ${formatVideoTime(d.timestampMs, 1)} (opens in a new tab)`}
      >
        Open clip
        <ExternalLink {...iconProps} />
      </a>
    );
  }
  if (b.clips && (b.clips.status === "queued" || b.clips.status === "running")) {
    return <span className="text-ink-muted">Being cut</span>;
  }
  return <Missing />;
}

/** A detection's confidence; Missing when the run gave none, not 0.00 under threshold. */
function Confidence({ d, threshold }: { d: Detection; threshold: number }) {
  if (d.confidence === null) return <Missing />;
  return <ConfidenceMeter score={d.confidence} threshold={threshold} />;
}

function UnmatchedSection({ b }: { b: MatchBenchmark }) {
  const list = b.recall!.unmatched;
  if (list.length === 0) {
    return (
      <p className="body">
        <span className="wl-inline-status wl-inline-status--ok">
          <Check {...iconProps} />
          Every detection matches a tag.
        </span>
      </p>
    );
  }
  const shown = list.slice(0, LIST_CAP);
  const threshold = (d: Detection) => b.thresholds[d.type];
  const status = (d: Detection) =>
    (b.statusByEvent.get(d.id) ?? "pending_review") as EventReviewState;
  return (
    <>
      <p className="body mb-3 text-ink-muted">
        Events the pipeline found that no hand tag matches.
      </p>
      <DataTable
        caption="Unmatched detections, goals and shots first"
        columns={[
          { id: "time", header: "Video time" },
          { id: "type", header: "Event" },
          { id: "side", header: "Side" },
          { id: "confidence", header: "Confidence" },
          { id: "status", header: "Status" },
          { id: "clip", header: "Clip" },
        ]}
        rows={shown.map((d) => ({
          id: d.id,
          cells: [
            <span key="time" className="data tabular-nums">
              {formatVideoTime(d.timestampMs, 1)}
            </span>,
            <span key="type">{kindLabel(d.type, d.onTarget)}</span>,
            <Side key="side" side={b.sideByEvent.get(d.id)} b={b} />,
            <Confidence key="c" d={d} threshold={threshold(d)} />,
            <EventStatusChip key="s" state={status(d)} />,
            <ClipCell key="clip" b={b} d={d} />,
          ],
        }))}
        cards={shown.map((d) => (
          <li key={d.id} className="wl-card flex flex-col gap-2">
            <div className="wl-row">
              <span className="data tabular-nums">{formatVideoTime(d.timestampMs, 1)}</span>
              <span className="body-strong">{kindLabel(d.type, d.onTarget)}</span>
              <EventStatusChip state={status(d)} />
            </div>
            <div className="wl-row">
              <Side side={b.sideByEvent.get(d.id)} b={b} />
              <Confidence d={d} threshold={threshold(d)} />
              <ClipCell b={b} d={d} />
            </div>
          </li>
        ))}
      />
      {list.length > LIST_CAP && (
        <p className="caption mt-3 text-ink-muted">
          Showing the first 100 of {formatCount(list.length)} unmatched detections.
        </p>
      )}
    </>
  );
}

type Counts = {
  tracks: number;
  linked: number;
  discarded: number;
  unlinked: number;
  points: number;
  events: number;
  autoAccepted: number;
  pendingReview: number;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function PipelineCard({ b, job }: { b: MatchBenchmark; job: LabJob }) {
  const parts = versionParts(job.modelVersion);
  const rtf = num(job.metadata.realtimeFactor);
  const startup = num(job.metadata.startupMs);
  const clips = b.clips;
  const clipsMeta = clips?.metadata ?? {};
  return (
    <div className="wl-card">
      <h3 className="body-strong">Pipeline</h3>
      <dl className="wl-facts mt-3">
        <dt className="label">CV job</dt>
        <dd className="body">
          <span className="wl-row">
            <JobStatusChip status={job.status} attempts={job.attempts} />
            <JobAttempt job={job} />
          </span>
        </dd>
        <dt className="label">Detector</dt>
        <dd className="body">
          {parts ? (
            <span className="wl-row">
              <span className="data break-all">{parts.detector}</span>
              {isSynthetic(job.modelVersion) && <SyntheticChip />}
            </span>
          ) : (
            <Missing />
          )}
        </dd>
        <dt className="label">Tracker</dt>
        <dd className="data break-all">{parts?.tracker ?? <Missing />}</dd>
        <dt className="label">Events</dt>
        <dd className="data break-all">{parts?.events ?? <Missing />}</dd>
        <dt className="label">Finished</dt>
        <dd className="body">{job.finishedAt ? formatDateTime(job.finishedAt) : <Missing />}</dd>
        <dt className="label">Speed</dt>
        <dd className="body">
          {rtf !== null ? <span className="data">{rtf.toFixed(2)} × real time</span> : <Missing />}
        </dd>
        <dt className="label">GPU start-up</dt>
        <dd className="body">
          {startup !== null && b.cv?.metadata && !isSynthetic(job.modelVersion) ? (
            <span className="data">{formatEta(startup / 1000)}</span>
          ) : (
            <Missing />
          )}
        </dd>
        <dt className="label">Clips job</dt>
        <dd className="body">
          {clips ? (
            <>
              <span className="wl-row">
                <JobStatusChip status={clips.status} attempts={clips.attempts} />
                <JobAttempt job={clips} />
              </span>
              {clips.status === "succeeded" && (
                <span className="caption block text-ink-muted">
                  {formatCount(num(clipsMeta.count) ?? 0)} clips ·{" "}
                  {formatSize(num(clipsMeta.bytes) ?? 0)} ·{" "}
                  {formatEta((num(clipsMeta.cutMs) ?? 0) / 1000)}
                </span>
              )}
            </>
          ) : (
            <Missing />
          )}
        </dd>
        <dt className="label">Ready in</dt>
        <dd className="body">
          {b.readySec === null ? (
            "Not ready yet"
          ) : (
            <span className="wl-row">
              <span className="data">{formatEta(b.readySec)} after upload</span>
              {b.readySec <= REVIEW_READY_TARGET_SEC ? (
                <span className="wl-inline-status wl-inline-status--ok">
                  <Check {...iconProps} />
                  Within 4 h target
                </span>
              ) : (
                <span className="wl-inline-status wl-inline-status--warn">
                  <Clock {...iconProps} />
                  Over 4 h target
                </span>
              )}
            </span>
          )}
        </dd>
        {job.status === "failed" && job.errorMessage && (
          <>
            <dt className="label">Last error</dt>
            <dd>
              <p className="data break-words">{job.errorMessage}</p>
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

function CountsCard({ b, from }: { b: MatchBenchmark; from: LabJob | null }) {
  const counts = from?.metadata.counts as Counts | undefined;
  const evidence = from?.metadata.teamSideEvidence as { kept: number; swapped: number } | undefined;
  const swapped = from?.metadata.teamSideSwapped === true;
  return (
    <div className="wl-card">
      <h3 className="body-strong">Tracks and events</h3>
      {!counts ? (
        <p className="body mt-3 text-ink-muted">Counts appear when the run finishes.</p>
      ) : (
        <>
          {from && b.cv && from.id !== b.cv.id && from.finishedAt && (
            <p className="caption mt-2 text-ink-muted">
              From the run on {formatDateTime(from.finishedAt)}.
            </p>
          )}
          <dl className="wl-facts mt-3">
            <dt className="label">Tracks kept</dt>
            <dd className="data">{formatCount(counts.tracks)}</dd>
            <dt className="label">Linked to players</dt>
            <dd className="data">{formatCount(counts.linked)}</dd>
            <dt className="label">Discarded at the consent check</dt>
            <dd className="data">{formatCount(counts.discarded)}</dd>
            <dt className="label">Unlinked</dt>
            <dd className="data">{formatCount(counts.unlinked)}</dd>
            <dt className="label">Position points</dt>
            <dd className="data">{formatCount(counts.points)}</dd>
            <dt className="label">Events</dt>
            <dd className="body">
              <span className="data">{formatCount(counts.events)}</span>
              <span className="caption block text-ink-muted">
                {formatCount(counts.autoAccepted)} auto-accepted ·{" "}
                {formatCount(counts.pendingReview)} pending review
              </span>
            </dd>
            <dt className="label">Sides</dt>
            <dd className="body">
              {evidence && swapped ? (
                `Swapped to match shirt numbers (${evidence.swapped} reads)`
              ) : evidence && evidence.kept > 0 ? (
                `Kept as detected (${evidence.kept} reads)`
              ) : (
                <span className="wl-inline-status wl-inline-status--warn">
                  <TriangleAlert {...iconProps} />
                  Not confirmed: no readable shirt numbers
                </span>
              )}
            </dd>
          </dl>
        </>
      )}
    </div>
  );
}

function CalibrationCard({ b }: { b: MatchBenchmark }) {
  const cal = b.calibration;
  return (
    <div className="wl-card">
      <h3 className="body-strong">Pitch calibration</h3>
      {!cal ? (
        <p className="body mt-3 text-ink-muted">Not calibrated yet.</p>
      ) : cal.source === "manual" ? (
        <>
          <dl className="wl-facts mt-3">
            <dt className="label">Source</dt>
            <dd className="body">Manual</dd>
            <dt className="label">Error</dt>
            <dd className="data">
              {cal.reprojectionErrorM !== null ? (
                `${cal.reprojectionErrorM.toFixed(1)} m`
              ) : (
                <Missing />
              )}
            </dd>
            <dt className="label">Points</dt>
            <dd className="data">{cal.pointCount ?? <Missing />}</dd>
            <dt className="label">Confidence</dt>
            <dd>
              <ConfidenceMeter score={cal.confidence} threshold={0.5} detail />
            </dd>
            <dt className="label">Saved</dt>
            <dd className="body">{formatDateTime(cal.createdAt)}</dd>
          </dl>
          {cal.sourceVideoId && cal.sourceVideoId !== b.video?.id && (
            <p className="caption mt-3 text-ink-muted">
              Reused from an earlier match at this venue and camera.
            </p>
          )}
        </>
      ) : (
        <>
          <dl className="wl-facts mt-3">
            <dt className="label">Source</dt>
            <dd className="body">
              <span className="wl-inline-status wl-inline-status--warn">
                <TriangleAlert {...iconProps} />
                Not calibrated
              </span>
            </dd>
            <dt className="label">Confidence</dt>
            <dd>
              <ConfidenceMeter score={cal.confidence} threshold={0.5} detail />
            </dd>
          </dl>
          <p className="caption mt-3 text-ink-muted">
            Positions are approximate until a platform admin calibrates this venue.
          </p>
        </>
      )}
      {b.stillKey && (
        <div className="mt-4">
          <ButtonLink
            href={`/lab/matches/${b.match.id}/calibration`}
            variant="secondary"
            size="sm"
            icon={Crosshair}
          >
            Calibrate pitch
          </ButtonLink>
        </div>
      )}
    </div>
  );
}

function RunSection({ b }: { b: MatchBenchmark }) {
  if (!b.cv) {
    return (
      <p className="body text-ink-muted">
        The CV job has not been queued yet. It starts when the footage is accepted.
      </p>
    );
  }
  const done = b.cv.status === "succeeded" ? b.cv : b.measured;
  const warnings = (done?.metadata.warnings as string[] | undefined) ?? [];
  return (
    <>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <PipelineCard b={b} job={b.cv} />
        <CountsCard b={b} from={done} />
        {done ? (
          <CalibrationCard b={b} />
        ) : (
          <div className="wl-card">
            <h3 className="body-strong">Pitch calibration</h3>
            <p className="body mt-3 text-ink-muted">Counts appear when the run finishes.</p>
          </div>
        )}
      </div>
      {warnings.length > 0 && (
        <div className="mt-6">
          <h3 className="body-strong">Warnings ({warnings.length})</h3>
          <ul className="wl-issues mt-3">
            {warnings.map((w) => (
              <li key={w} className="wl-issues__warn">
                <TriangleAlert {...iconProps} />
                <p className="body break-words">{w}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export default async function MatchBenchmarkPage({
  params,
  searchParams,
}: {
  params: Promise<{ matchId: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const ctx = await requirePageRole(LAB_ROLES);
  const { matchId } = await params;
  const { done } = await searchParams;
  const b = await matchBenchmark(ctx, matchId);
  if (!b) notFound();

  const state = footageState(b);
  const meta = [formatMatchDate(b.match.playedAt), b.match.competition, b.match.venue]
    .filter(Boolean)
    .join(" · ");
  const measured = b.recall !== null;

  return (
    <DetailPage
      back={{ href: "/lab/matches", label: "Matches" }}
      eyebrow="CV Lab · Match benchmark"
      title={`${b.match.home} v ${b.match.away}`}
      meta={meta}
      badges={
        <>
          <MatchStatusChip status={b.match.status} />
          {b.video?.deletedAt ? (
            <span className="wl-inline-status wl-inline-status--muted">
              <Trash2 {...iconProps} />
              Deleted
            </span>
          ) : (
            state && <FootageChip state={state} />
          )}
          {b.cv && isSynthetic(b.cv.modelVersion) && <SyntheticChip />}
        </>
      }
      actions={
        b.stillKey ? (
          <ButtonLink
            href={`/lab/matches/${b.match.id}/calibration`}
            variant="secondary"
            icon={Crosshair}
            className="max-md:w-full max-md:justify-center"
          >
            Calibrate pitch
          </ButtonLink>
        ) : undefined
      }
      notice={
        <div aria-live="polite" className={done === "calibrated" ? "mt-6" : undefined}>
          {done === "calibrated" && <FocusHeadingOnMount />}
          {done === "calibrated" && (
            <Banner tone="ok">
              Calibration saved. This match&apos;s positions are re-projected, and later matches at
              this venue and camera use it.
            </Banner>
          )}
        </div>
      }
      sections={[
        { id: "recall", anchor: "recall", title: "Recall", content: <RecallSection b={b} /> },
        ...(measured
          ? [
              {
                id: "missed",
                anchor: "missed",
                title: "Missed tags",
                content: <MissedSection b={b} />,
              },
              {
                id: "unmatched",
                anchor: "unmatched",
                title: "Unmatched detections",
                content: <UnmatchedSection b={b} />,
              },
            ]
          : []),
        { id: "run", anchor: "run", title: "Run", content: <RunSection b={b} /> },
        {
          id: "import",
          anchor: "import",
          title: "Import tags",
          content: <ImportTagsForm matchId={b.match.id} counts={b.tagCounts} />,
        },
      ]}
    />
  );
}
