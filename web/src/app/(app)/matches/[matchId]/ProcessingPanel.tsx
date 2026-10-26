import {
  Check,
  CircleAlert,
  CircleDashed,
  LoaderCircle,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { iconProps } from "@/components/ui/icons";
import type { TranscodeStep } from "@/server/processing/summary";

/**
 * The processing steps in the Footage card (MATCH07; docs/build/design/C07.md,
 * Surface 2): Preparing playback from the transcode job, then a Finding
 * events placeholder until C08. Every state is an icon, a word and a caption;
 * colour only reinforces (NFR27). Nothing spins.
 */

type Step = {
  icon: LucideIcon;
  name: string;
  state: string;
  caption: string | null;
  done?: boolean;
  tone?: "retrying" | "failed";
};

export function playbackStep(job: TranscodeStep | null): Step {
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

/** C08 replaces this with its own job states, in the same shape. */
export function eventsStep(job: TranscodeStep | null): Step {
  const name = "Finding events";
  if (job?.status === "failed") {
    return { icon: CircleDashed, name, state: "Not started", caption: null };
  }
  if (job?.status === "succeeded") {
    return {
      icon: CircleDashed,
      name,
      state: "Waiting to start",
      caption: "We find goals, shots and passes, then a scout checks them.",
    };
  }
  return {
    icon: CircleDashed,
    name,
    state: "Not started",
    caption: "Starts after playback is ready.",
  };
}

export function ProcessingPanel({ job }: { job: TranscodeStep | null | "unavailable" }) {
  return (
    <>
      <h3 className="body-strong mt-6">Processing</h3>
      {job === "unavailable" ? (
        <p className="body mt-2 text-ink-muted">
          Processing status is not available right now. This page updates every 30 seconds.
        </p>
      ) : (
        <ol className="wl-checklist mt-2" role="list">
          {[playbackStep(job), eventsStep(job)].map((s) => (
            <li key={s.name} data-done={s.done ? "true" : undefined} data-state={s.tone}>
              <s.icon {...iconProps} />
              <div>
                <span className="body">
                  {s.name} · <span className="body-strong">{s.state}</span>
                </span>
                {s.caption && <p className="caption text-ink-muted">{s.caption}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
