import { Check, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import { EmptyState } from "@/components/states/EmptyState";
import { DataTable, Missing } from "@/components/templates/DataTable";
import { ListPage } from "@/components/templates/ListPage";
import { iconProps } from "@/components/ui/icons";
import { FootageChip, JobStatusChip, MatchStatusChip } from "@/components/ui/StatusChip";
import type { FootageState } from "@/components/ui/StatusChip";
import { formatDate, formatRate, SMALL_SAMPLE_TAGS } from "@/lib/labels";
import { LAB_ROLES, requirePageRole } from "@/server/auth/session";
import { labMatchRows, type LabJob, type LabMatchRow, type LabVideo } from "@/server/lab/benchmark";
import { meetsTarget, type RecallRow } from "@/server/lab/recall";
import { DetectorVersion, JobAttempt, ReadyIn, ROW_LABELS } from "../lab-ui";

export const metadata = { title: "Matches" };

// The Lab's match list (docs/build/design/C09.md, Surface 2): footage, the
// latest CV and clips jobs, goal and shot recall, and time to review-ready.

const COLUMNS = [
  { id: "match", header: "Match" },
  { id: "date", header: "Date" },
  { id: "status", header: "Status" },
  { id: "video", header: "Footage" },
  { id: "job", header: "Latest job" },
  { id: "recall", header: "Recall", numeric: true },
  { id: "ready", header: "Ready in", numeric: true },
];

function footageState(v: LabVideo): FootageState {
  if (v.status === "accepted" && v.validation?.verdict === "accepted_with_warnings") {
    return "accepted_with_warnings";
  }
  return v.status;
}

function Footage({ video }: { video: LabVideo | null }) {
  if (!video) return <Missing />;
  if (video.deletedAt) {
    return (
      <span className="wl-inline-status wl-inline-status--muted">
        <Trash2 {...iconProps} />
        Deleted
      </span>
    );
  }
  return <FootageChip state={footageState(video)} />;
}

function JobLine({
  label,
  job,
  version,
}: {
  label: string;
  job: LabJob | null;
  version?: boolean;
}) {
  return (
    <span className="wl-row">
      <span className="text-label text-ink-muted">{label}</span>
      {job ? (
        <>
          <JobStatusChip status={job.status} attempts={job.attempts} />
          <JobAttempt job={job} />
          {version && job.modelVersion && <DetectorVersion modelVersion={job.modelVersion} />}
        </>
      ) : (
        <Missing />
      )}
    </span>
  );
}

function LatestJob({ m }: { m: LabMatchRow }) {
  if (!m.cv && !m.clips) return <span className="text-ink-muted">None yet</span>;
  return (
    <div className="flex flex-col gap-1">
      <JobLine label="CV" job={m.cv} version />
      <JobLine label="Clips" job={m.clips} />
    </div>
  );
}

function RecallLine({ row }: { row: RecallRow }) {
  const label = ROW_LABELS[row.type];
  if (row.tagged === 0) {
    return (
      <span className="wl-row">
        <span className="text-label">{label}</span>
        <span className="text-body-s text-ink-muted">no tags</span>
      </span>
    );
  }
  const ok = meetsTarget(row);
  return (
    <span className="flex flex-col items-end">
      <span className={`wl-inline-status wl-inline-status--${ok ? "ok" : "warn"}`}>
        {ok ? <Check {...iconProps} /> : <TriangleAlert {...iconProps} />}
        <span className="text-label">{label}</span>
        <span className="font-mono text-mono-m tabular-nums">
          {formatRate(row.matched, row.tagged)}
        </span>
        <span className="text-body-s text-ink-muted">
          {row.matched} of {row.tagged}
        </span>
        <span className="sr-only">{ok ? ", meets 95% target" : ", below 95% target"}</span>
      </span>
      {row.tagged < SMALL_SAMPLE_TAGS && (
        <span className="wl-stat__sample wl-stat__sample--small text-body-s">Small sample</span>
      )}
    </span>
  );
}

function Recall({ m }: { m: LabMatchRow }) {
  if (m.tagCount === 0) return <span className="text-ink-muted">No tags</span>;
  if (!m.recall) return <span className="text-ink-muted">Waiting for CV</span>;
  return (
    <div className="flex flex-col gap-1">
      {m.recall.map((r) => (
        <RecallLine key={r.type} row={r} />
      ))}
    </div>
  );
}

export default async function MatchesPage() {
  const ctx = await requirePageRole(LAB_ROLES);
  const matches = await labMatchRows(ctx);

  const fixture = (m: LabMatchRow) => (
    <>
      {m.home}
      <span className="text-ink-muted"> v </span>
      {m.away}
    </>
  );

  return (
    <ListPage
      header={{ eyebrow: "CV Lab", title: "Matches" }}
      isEmpty={matches.length === 0}
      empty={
        <EmptyState
          title="No matches yet"
          body="Create one to upload footage and run the pipeline."
        />
      }
    >
      <DataTable
        caption="Matches, newest first"
        columns={COLUMNS}
        rows={matches.map((m) => ({
          id: m.id,
          cells: [
            <Fragment key="match">
              <Link
                href={`/lab/matches/${m.id}`}
                className="font-semibold text-brand-text underline"
              >
                {fixture(m)}
              </Link>
              {m.competition && (
                <span className="text-body-s block text-ink-muted">{m.competition}</span>
              )}
            </Fragment>,
            <span key="date" className="font-mono text-mono-m tabular-nums whitespace-nowrap">
              {formatDate(m.playedAt)}
            </span>,
            <MatchStatusChip key="status" status={m.status} />,
            <Footage key="video" video={m.video} />,
            <LatestJob key="job" m={m} />,
            <Recall key="recall" m={m} />,
            <ReadyIn key="ready" seconds={m.readySec} />,
          ],
        }))}
        cards={matches.map((m) => (
          <li key={m.id} className="wl-card flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/lab/matches/${m.id}`} className="wl-link-row font-semibold min-w-0">
                {fixture(m)}
              </Link>
              <MatchStatusChip status={m.status} />
            </div>
            <p className="text-body-s text-ink-muted">
              <span className="font-mono text-mono-m tabular-nums">{formatDate(m.playedAt)}</span>
              {m.competition && <> · {m.competition}</>}
            </p>
            <dl className="wl-facts">
              <dt className="text-label">Footage</dt>
              <dd>
                <Footage video={m.video} />
              </dd>
              <dt className="text-label">CV job</dt>
              <dd>
                {m.cv ? (
                  <span className="wl-row">
                    <JobStatusChip status={m.cv.status} attempts={m.cv.attempts} />
                    <JobAttempt job={m.cv} />
                    <DetectorVersion modelVersion={m.cv.modelVersion} />
                  </span>
                ) : (
                  <Missing />
                )}
              </dd>
              <dt className="text-label">Clips job</dt>
              <dd>
                {m.clips ? (
                  <span className="wl-row">
                    <JobStatusChip status={m.clips.status} attempts={m.clips.attempts} />
                    <JobAttempt job={m.clips} />
                  </span>
                ) : (
                  <Missing />
                )}
              </dd>
              <dt className="text-label">Recall</dt>
              <dd>
                <Recall m={m} />
              </dd>
              <dt className="text-label">Ready in</dt>
              <dd>
                <ReadyIn seconds={m.readySec} />
              </dd>
            </dl>
          </li>
        ))}
      />
    </ListPage>
  );
}
