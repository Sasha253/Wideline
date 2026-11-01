import {
  Check,
  CircleAlert,
  CircleDashed,
  LoaderCircle,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { cx } from "@/components/ui/cx";
import { iconProps } from "@/components/ui/icons";
import type { ProcessingStep } from "@/server/processing/summary";

/**
 * The processing steps in the Footage card (MATCH07; docs/build/design/C07.md,
 * Surface 2): Preparing playback from the transcode job and, from C08,
 * Finding events from the CV job. The two run at the same time. C09 adds
 * Cutting clips, from the clips job the CV ingest creates
 * (docs/build/design/C09.md, Surface 6). Every state is an icon, a word and a
 * caption; colour only reinforces (NFR27). Nothing spins.
 */

type Step = {
  icon: LucideIcon;
  name: string;
  state: string;
  caption: string | null;
  done?: boolean;
  tone?: "retrying" | "failed";
};

export function playbackStep(job: ProcessingStep | null): Step {
  const name = "Preparing playback";
  if (!job || (job.status === "queued" && job.attempts === 0)) {
    return {
      icon: CircleDashed,
      name,
      state: "Waiting to start",
      caption: "Starts in a few minutes.",
    };
  }
  const max = job.maxAttempts;
  switch (job.status) {
    case "running":
      return job.attempts <= 1
        ? {
            icon: LoaderCircle,
            name,
            state: "In progress",
            caption:
              "Making copies of the video at three qualities, so it plays smoothly in the browser.",
          }
        : {
            icon: LoaderCircle,
            name,
            tone: "retrying",
            state: `In progress, attempt ${job.attempts} of ${max}`,
            caption:
              job.attempts === 2
                ? "The first try did not finish, so we are trying again."
                : "Earlier tries did not finish, so we are trying again.",
          };
    case "queued":
      return {
        icon: RotateCcw,
        name,
        tone: "retrying",
        state: `Trying again soon, attempt ${job.attempts + 1} of ${max}`,
        caption: "The last try did not finish. We try again in a minute.",
      };
    case "succeeded":
      return {
        icon: Check,
        name,
        done: true,
        state: "Ready",
        caption: "You can watch the match below.",
      };
    case "failed":
      return {
        icon: CircleAlert,
        name,
        tone: "failed",
        state: "Failed",
        caption: `We tried ${max} times. Wideline staff have been told and will try again.`,
      };
  }
}

/** The CV job (C08): goals, shots and touches; a scout checks the unsure ones. */
export function eventsStep(job: ProcessingStep | null): Step {
  const name = "Finding events";
  if (!job || (job.status === "queued" && job.attempts === 0)) {
    return {
      icon: CircleDashed,
      name,
      state: "Waiting to start",
      caption: "Starts in a few minutes.",
    };
  }
  const max = job.maxAttempts;
  switch (job.status) {
    case "running":
      return job.attempts <= 1
        ? {
            icon: LoaderCircle,
            name,
            state: "In progress",
            caption: "Looking for goals, shots and touches in the footage.",
          }
        : {
            icon: LoaderCircle,
            name,
            tone: "retrying",
            state: `In progress, attempt ${job.attempts} of ${max}`,
            caption:
              job.attempts === 2
                ? "The first try did not finish, so we are trying again."
                : "Earlier tries did not finish, so we are trying again.",
          };
    case "queued":
      return {
        icon: RotateCcw,
        name,
        tone: "retrying",
        state: `Trying again soon, attempt ${job.attempts + 1} of ${max}`,
        caption: "The last try did not finish. We try again in a minute.",
      };
    case "succeeded":
      return {
        icon: Check,
        name,
        done: true,
        state: "Done",
        caption: "A scout checks the events next.",
      };
    case "failed":
      // Settled without a try: the transcode failed first, and its step says so.
      if (job.attempts === 0) {
        return { icon: CircleDashed, name, state: "Not started", caption: null };
      }
      return {
        icon: CircleAlert,
        name,
        tone: "failed",
        state: "Failed",
        caption: `We tried ${max} times. Wideline staff have been told and will try again.`,
      };
  }
}

/** The clips job (C09): one short clip per event, kept 14 days unless favourited. */
export function clipsStep(job: ProcessingStep | null): Step {
  const name = "Cutting clips";
  if (!job || (job.status === "queued" && job.attempts === 0)) {
    return {
      icon: CircleDashed,
      name,
      state: "Waiting to start",
      caption: "Starts once events are found.",
    };
  }
  const max = job.maxAttempts;
  switch (job.status) {
    case "running":
      return job.attempts <= 1
        ? {
            icon: LoaderCircle,
            name,
            state: "In progress",
            caption: "Cutting a short clip around each event.",
          }
        : {
            icon: LoaderCircle,
            name,
            tone: "retrying",
            state: `In progress, attempt ${job.attempts} of ${max}`,
            caption:
              job.attempts === 2
                ? "The first try did not finish, so we are trying again."
                : "Earlier tries did not finish, so we are trying again.",
          };
    case "queued":
      return {
        icon: RotateCcw,
        name,
        tone: "retrying",
        state: `Trying again soon, attempt ${job.attempts + 1} of ${max}`,
        caption: "The last try did not finish. We try again in a minute.",
      };
    case "succeeded":
      return {
        icon: Check,
        name,
        done: true,
        state: "Clips ready",
        caption:
          job.clips === 0
            ? "No events were found, so there are no clips."
            : "Each clip is kept for 14 days unless it is marked as a favourite.",
      };
    case "failed":
      // Settled without a try: an earlier step failed, and its step says so.
      if (job.attempts === 0) {
        return { icon: CircleDashed, name, state: "Not started", caption: null };
      }
      return {
        icon: CircleAlert,
        name,
        tone: "failed",
        state: "Failed",
        caption: `We tried ${max} times. Wideline staff have been told and will try again.`,
      };
  }
}

/** Where one pipeline step is: settled, running now, stopped, or not reached yet. */
export type PipelineState = "done" | "current" | "failed" | "waiting" | "person";

export type PipelineRow = {
  name: string;
  /** The state in words, always shown beside the disc (never colour alone). */
  state: string;
  caption: string | null;
  status: PipelineState;
};

function rowOf(s: Step): PipelineRow {
  // A queued retry (RotateCcw) is waiting on the system, not running: thin outline, no lime.
  const status: PipelineState = s.done
    ? "done"
    : s.tone === "failed"
      ? "failed"
      : s.icon === LoaderCircle
        ? "current"
        : "waiting";
  return { name: s.name, state: s.state, caption: s.caption, status };
}

/** The three job steps (transcode, CV, clips) as pipeline rows. */
export function jobRows(steps: {
  transcode: ProcessingStep | null;
  cv: ProcessingStep | null;
  clips?: ProcessingStep | null;
}): PipelineRow[] {
  return [playbackStep(steps.transcode), eventsStep(steps.cv), clipsStep(steps.clips ?? null)].map(
    rowOf,
  );
}

const DISC: Record<PipelineState, string> = {
  // Solid: settled.
  done: "bg-confirmed text-on-status border-2 border-confirmed",
  // Ink outline: running now (the lime bar below says it is live).
  current: "border-2 border-ink text-ink",
  failed: "bg-rejected-subtle text-rejected border border-rejected",
  // Thin outline: waiting on the system.
  waiting: "border border-line-strong text-ink-muted",
  // Dashed: waiting on a person.
  person: "border-pending text-pending",
};

const DISC_ICON: Partial<Record<PipelineState, LucideIcon>> = {
  done: Check,
  current: LoaderCircle,
  failed: CircleAlert,
  person: CircleDashed,
};

/**
 * The named pipeline steps of a processing match (Floodlight Screens A, "Match detail ·
 * processing"): a numbered disc, the step name, its state in words and a caption. Only a
 * running step gets the lime bar; there is no percentage for the whole job. Nothing spins.
 */
export function PipelineSteps({ rows }: { rows: PipelineRow[] }) {
  return (
    <ol role="list" className="flex flex-col">
      {rows.map((r, i) => {
        const Icon = DISC_ICON[r.status];
        return (
          <li
            key={r.name}
            data-state={r.status}
            className={cx(
              "grid grid-cols-[28px_minmax(0,1fr)] items-center gap-4 border-b border-line px-5 py-3.5 last:border-b-0 touch:px-4",
              r.status === "current" && "bg-raised",
            )}
          >
            <span
              aria-hidden
              className={cx(
                "box-border grid size-7 place-items-center rounded-full font-mono text-mono-m font-semibold tabular-nums",
                DISC[r.status],
              )}
            >
              {Icon ? <Icon {...iconProps} size={14} /> : i + 1}
            </span>
            <span className="flex min-w-0 flex-col gap-1.5">
              <span
                className={cx(
                  "text-body leading-tight",
                  r.status === "current" ? "font-semibold" : "font-medium",
                  r.status === "waiting" ? "text-ink-muted" : "text-ink",
                )}
              >
                {r.name}
              </span>
              <span className="text-body-s text-ink-muted">
                <span
                  className={cx(
                    "font-semibold",
                    r.status === "failed" ? "text-rejected" : "text-ink",
                  )}
                >
                  {r.state}
                </span>
                {r.caption && <> · {r.caption}</>}
              </span>
              {r.status === "current" && (
                // No step progress is reported yet, so a short static segment marks the
                // live step; a full bar would read as complete.
                <span aria-hidden className="mt-1 block h-1.5 bg-selected">
                  <span className="block h-full w-1/4 border border-brand-edge bg-brand" />
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The job steps alone, for callers that only have the processing summary. The match page
 * uses PipelineSteps with the full six rows.
 */
export function ProcessingPanel({
  steps,
}: {
  steps:
    | {
        transcode: ProcessingStep | null;
        cv: ProcessingStep | null;
        clips?: ProcessingStep | null;
      }
    | "unavailable";
}) {
  if (steps === "unavailable") {
    return (
      <p className="px-5 py-3.5 text-ink-muted">
        Processing status is not available right now. This page updates every 30 seconds.
      </p>
    );
  }
  return <PipelineSteps rows={jobRows(steps)} />;
}
