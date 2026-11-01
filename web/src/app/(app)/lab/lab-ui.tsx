import { Check, Clock, FlaskConical, TriangleAlert } from "lucide-react";
import { Fragment } from "react";
import { DataTable, Missing } from "@/components/templates/DataTable";
import { iconProps } from "@/components/ui/icons";
import { StatusChip } from "@/components/ui/StatusChip";
import type { AutoAcceptThresholds } from "@/lib/auto-accept";
import { formatEta, formatRate, SMALL_SAMPLE_MATCHES, SMALL_SAMPLE_TAGS } from "@/lib/labels";
import { isSynthetic, versionParts } from "@/server/lab/benchmark";
import { meetsTarget, type RecallRow, type RecallRowType } from "@/server/lab/recall";
import { REVIEW_READY_TARGET_SEC } from "@/server/lab/timings";

// Pieces shared by the C09 Lab pages (docs/build/design/C09.md, "Rules for the whole chunk").

export const ROW_LABELS: Record<RecallRowType, string> = {
  goal: "Goal",
  shot: "Shot",
  shot_on_target: "Shot on target",
  touch: "Touch",
};

/** The Synthetic chip: a synthetic run never reads as a model result. */
export function SyntheticChip() {
  return <StatusChip tone="neutral" icon={FlaskConical} label="Synthetic" />;
}

/** The detector part of a model version, with the Synthetic chip when it applies. */
export function DetectorVersion({ modelVersion }: { modelVersion: string | null }) {
  const parts = versionParts(modelVersion);
  if (!parts) return <Missing />;
  return (
    <span className="wl-row">
      <span className="font-mono text-mono-m tabular-nums break-all text-ink-muted">
        {parts.detector}
      </span>
      {isSynthetic(modelVersion) && <SyntheticChip />}
    </span>
  );
}

/** "Small sample · 4 tagged" (or "· 2 matches"), in warning, under a rate (Q-048). */
export function SmallSample({ text }: { text: string }) {
  return (
    <span className="wl-stat__sample wl-stat__sample--small text-body-s">
      Small sample · {text}
    </span>
  );
}

/** Why a sample is small, or null: matches first, then tags (Q-048). */
export function smallSampleText(tagged: number, matches?: number): string | null {
  if (matches !== undefined && matches < SMALL_SAMPLE_MATCHES) {
    return `${matches} ${matches === 1 ? "match" : "matches"}`;
  }
  if (tagged < SMALL_SAMPLE_TAGS) return `${tagged} tagged`;
  return null;
}

/** A rate and its sample in one table cell: "82%" over "9 of 11". */
export function RateCell({
  matched,
  total,
  small,
}: {
  matched: number;
  total: number;
  small?: string | null;
}) {
  const rate = formatRate(matched, total);
  if (rate === null) return <Missing />;
  return (
    <span className="inline-flex flex-col items-end">
      <span className="font-mono text-mono-m tabular-nums">{rate}</span>
      <span className="text-body-s text-ink-muted">
        {matched} of {total}
      </span>
      {small && <SmallSample text={small} />}
    </span>
  );
}

/** "82% · 9 of 11" inline, for cards and sentences. */
export function rateText(matched: number, total: number): string | null {
  const rate = formatRate(matched, total);
  return rate === null ? null : `${rate} · ${matched} of ${total}`;
}

/** The v0 target as words and an icon (NFR27), Missing for rows without one. */
export function TargetStatus({ row }: { row: RecallRow }) {
  if (row.type === "shot_on_target" || row.type === "touch") return <Missing />;
  if (row.tagged === 0) return <span className="text-ink-muted">No tags</span>;
  return meetsTarget(row) ? (
    <span className="wl-inline-status wl-inline-status--ok">
      <Check {...iconProps} />
      Meets 95%
    </span>
  ) : (
    <span className="wl-inline-status wl-inline-status--warn">
      <TriangleAlert {...iconProps} />
      Below 95%
    </span>
  );
}

/**
 * "attempt 2 of 3" beside a JobStatusChip, for a running job past its first
 * attempt or a job waiting to retry (the next attempt, as ProcessingPanel says).
 */
export function JobAttempt({
  job,
}: {
  job: { status: string; attempts: number; maxAttempts: number };
}) {
  const n =
    job.status === "running" && job.attempts > 1
      ? job.attempts
      : job.status === "queued" && job.attempts >= 1
        ? job.attempts + 1
        : null;
  if (n === null) return null;
  return (
    <span className="text-body-s text-ink-muted">
      attempt {n} of {job.maxAttempts}
    </span>
  );
}

/** Ready in: the duration, flagged when over the 4 h target (NFR01). */
export function ReadyIn({ seconds }: { seconds: number | null }) {
  if (seconds === null) return <Missing />;
  if (seconds > REVIEW_READY_TARGET_SEC) {
    return (
      <span className="wl-inline-status wl-inline-status--warn">
        <Clock {...iconProps} />
        <span className="font-mono text-mono-m tabular-nums">{formatEta(seconds)}</span>
        <span className="sr-only">, over the 4 h target</span>
      </span>
    );
  }
  return <span className="font-mono text-mono-m tabular-nums">{formatEta(seconds)}</span>;
}

/** The recall table of one match or one model version, with phone cards. */
export function RecallTable({
  caption,
  rows,
  matchesPerRow,
  versionMatches,
  notYet = false,
}: {
  caption: string;
  rows: readonly RecallRow[];
  /** Tags without a finished CV run: Tagged shows, the rest is Missing or "Not yet". */
  notYet?: boolean;
  /** Benchmark only: matches behind each row, and the version's match count. */
  matchesPerRow?: Record<RecallRowType, number>;
  versionMatches?: number;
}) {
  const withMatches = matchesPerRow !== undefined;
  const columns = [
    { id: "type", header: "Event" },
    ...(withMatches ? [{ id: "matches", header: "Matches", numeric: true }] : []),
    { id: "tagged", header: "Tagged", numeric: true },
    { id: "found", header: "Detected", numeric: true },
    { id: "recall", header: "Recall", numeric: true },
    { id: "precision", header: "Precision", numeric: true },
    { id: "auto", header: "Auto-accepted recall", numeric: true },
    { id: "target", header: "v0 target" },
  ];
  const small = (r: RecallRow) => (notYet ? null : smallSampleText(r.tagged, versionMatches));
  const target = (r: RecallRow) =>
    notYet ? <span className="text-ink-muted">Not yet</span> : <TargetStatus row={r} />;
  const rateCell = (matched: number, total: number, flag?: string | null) =>
    notYet ? <Missing /> : <RateCell matched={matched} total={total} small={flag} />;
  const rateCard = (matched: number, total: number) =>
    (notYet ? null : rateText(matched, total)) ?? <Missing />;
  return (
    <DataTable
      caption={caption}
      columns={columns}
      rows={rows.map((r) => ({
        id: r.type,
        cells: [
          <span key="type" className="font-semibold">
            {ROW_LABELS[r.type]}
          </span>,
          ...(withMatches ? [<span key="m">{matchesPerRow![r.type]}</span>] : []),
          <span key="tagged">{r.tagged}</span>,
          notYet ? <Missing key="found" /> : <span key="found">{r.detected}</span>,
          <Fragment key="recall">
            {rateCell(r.matched, r.tagged, r.tagged ? small(r) : null)}
          </Fragment>,
          <Fragment key="precision">{rateCell(r.matched, r.detected)}</Fragment>,
          <Fragment key="auto">{rateCell(r.autoMatched, r.tagged)}</Fragment>,
          <Fragment key="target">{target(r)}</Fragment>,
        ],
      }))}
      cards={rows.map((r) => {
        const flag = r.tagged ? small(r) : null;
        return (
          <li key={r.type} className="wl-card flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <span className="font-semibold">{ROW_LABELS[r.type]}</span>
              {target(r)}
            </div>
            <dl className="wl-facts">
              {withMatches && (
                <>
                  <dt className="text-label">Matches</dt>
                  <dd className="font-mono text-mono-m tabular-nums">{matchesPerRow![r.type]}</dd>
                </>
              )}
              <dt className="text-label">Tagged</dt>
              <dd className="font-mono text-mono-m tabular-nums">{r.tagged}</dd>
              <dt className="text-label">Detected</dt>
              <dd className="font-mono text-mono-m tabular-nums">
                {notYet ? <Missing /> : r.detected}
              </dd>
              <dt className="text-label">Recall</dt>
              <dd className="font-mono text-mono-m tabular-nums">
                {rateCard(r.matched, r.tagged)}
              </dd>
              <dt className="text-label">Precision</dt>
              <dd className="font-mono text-mono-m tabular-nums">
                {rateCard(r.matched, r.detected)}
              </dd>
              <dt className="text-label">Auto-accepted recall</dt>
              <dd className="font-mono text-mono-m tabular-nums">
                {rateCard(r.autoMatched, r.tagged)}
              </dd>
            </dl>
            {flag && <SmallSample text={flag} />}
          </li>
        );
      })}
    />
  );
}

/** The tolerance and population note under a recall table. */
export function ToleranceNote({ thresholds }: { thresholds: AutoAcceptThresholds }) {
  const t = (n: number) => (
    <span className="font-mono text-mono-m tabular-nums">{n.toFixed(2)}</span>
  );
  return (
    <p className="text-body-s mt-3 text-ink-muted">
      A detection counts when it is the same type and within 2 s of a tag (goals and shots) or 1 s
      (touches), each tag matched once. Recall counts every detection of the latest CV run, whatever
      its review status. Auto-accepted recall counts only detections at or above the auto-accept
      threshold: goal {t(thresholds.goal)}, shot {t(thresholds.shot)}, touch {t(thresholds.touch)}.
    </p>
  );
}
