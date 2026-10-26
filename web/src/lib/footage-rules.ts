import { formatFps } from "./labels";
import { matchLengthMin } from "./match-clock";

// The footage check (MATCH03, MATCH04; docs/build/design/C06.md, "Footage issue
// copy"). Pure and client-safe: the worker runs it on ffprobe output
// (src/server/matches/probe.ts), and the pages show the stored result.
//
// Draft for review: every threshold in FOOTAGE_RULES and every message and
// guidance text below (docs/build/QUESTIONS.md, Q-027). The screen never
// says "draft".

export const FOOTAGE_RULES = {
  /** Shorter than this is not a match recording: rejected. */
  minDurationSec: 5 * 60,
  /** The short side of the display frame, after rotation: 1080p. */
  minShortSidePx: 1080,
  /** Below this, tracking fails: rejected. */
  minFps: 20,
  /** Below this (and at or above minFps), a warning. */
  goodFps: 25,
  /** Display aspect below this may not show the whole pitch (16:9 is 1.78). */
  minWideAspect: 1.7,
  /** A duration more than this under 2 x half length warns. */
  durationSlackMin: 10,
  /** Longer than this warns. */
  maxDurationMin: 150,
} as const;

/** What the worker read from ffprobe. width and height are the display size, after rotation. */
export type ProbeSummary = {
  hasVideo: boolean;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  /** Display width over height, sample aspect ratio applied. */
  displayAspect: number | null;
  codec: string | null;
  rotation: number;
};

export type FootageIssueCode =
  | "no_video"
  | "unreadable"
  | "too_short"
  | "low_resolution"
  | "portrait"
  | "low_fps"
  | "fps_marginal"
  | "fps_unknown"
  | "not_wide"
  | "duration_short"
  | "duration_long";

export type FootageIssue = {
  code: FootageIssueCode;
  severity: "reject" | "warn";
  /** What is wrong (body-strong). */
  message: string;
  /** How to re-film (body). */
  guidance: string;
};

export type FootageVerdict = "accepted" | "accepted_with_warnings" | "rejected";

export type FootageValidation = { verdict: FootageVerdict; issues: FootageIssue[] };

const GUIDANCE: Record<FootageIssueCode, string> = {
  no_video:
    "Export the match again from your camera's app as an MP4 or MOV file, then upload that file.",
  unreadable:
    "The file may be damaged or was still copying. Export it again from your camera's app and upload the new file.",
  too_short: "Upload the whole match in one file, from before kickoff to after full time.",
  low_resolution:
    "Set the camera to 1080p or higher before the next match, and export at the original quality. Phone apps often shrink exports to 720p.",
  portrait:
    "Turn the camera on its side (landscape) and mount it high on the halfway line, so the whole pitch is in the frame.",
  low_fps: "Set the camera to 25 or 30 frames per second.",
  fps_marginal: "Set the camera to 25 or 30 frames per second for the next match.",
  fps_unknown: "Check that the camera records at 25 or 30 frames per second.",
  not_wide:
    "Use a wide-angle camera, or a phone's 0.5× lens, high on the halfway line. Both goals should be in the frame.",
  duration_short: "Check that you uploaded the whole match, not one half.",
  duration_long: "You can keep it. Mark kickoff and full time, so only the match is analysed.",
};

const issue = (
  code: FootageIssueCode,
  severity: FootageIssue["severity"],
  message: string,
): FootageIssue => ({ code, severity, message, guidance: GUIDANCE[code] });

const wholeMinutes = (sec: number) => Math.floor(sec / 60);

/**
 * Checks probed footage against FOOTAGE_RULES. Any reject issue rejects the
 * file; warnings alone accept it with warnings. null (ffprobe could not read
 * the file) is unreadable.
 */
export function evaluateFootage(
  probe: ProbeSummary | null,
  { halfLengthMinutes }: { halfLengthMinutes: number },
): FootageValidation {
  const issues: FootageIssue[] = [];
  const R = FOOTAGE_RULES;
  if (!probe) {
    issues.push(issue("unreadable", "reject", "We could not read this file."));
  } else if (!probe.hasVideo) {
    issues.push(issue("no_video", "reject", "This file has no video in it."));
  } else if (probe.width === null || probe.height === null || probe.durationSec === null) {
    issues.push(issue("unreadable", "reject", "We could not read this file."));
  } else {
    const { width: w, height: h, durationSec, fps, displayAspect } = probe;
    if (durationSec < R.minDurationSec) {
      issues.push(
        issue(
          "too_short",
          "reject",
          `This video is ${wholeMinutes(durationSec)} min long. A match recording needs at least 5 min.`,
        ),
      );
    }
    const portrait = h > w;
    if (portrait) {
      issues.push(issue("portrait", "reject", "This video was filmed upright (portrait)."));
    }
    if (Math.min(w, h) < R.minShortSidePx) {
      issues.push(
        issue(
          "low_resolution",
          "reject",
          `This video is ${w} × ${h}. Wideline needs at least 1080p (1920 × 1080).`,
        ),
      );
    }
    if (fps === null) {
      issues.push(issue("fps_unknown", "warn", "We could not read this video's frame rate."));
    } else if (fps < R.minFps) {
      issues.push(
        issue(
          "low_fps",
          "reject",
          `This video runs at ${formatFps(fps)} frames per second. Wideline needs at least 20.`,
        ),
      );
    } else if (fps < R.goodFps) {
      issues.push(
        issue(
          "fps_marginal",
          "warn",
          `This video runs at ${formatFps(fps)} frames per second. Tracking works best at 25 or more.`,
        ),
      );
    }
    const aspect = displayAspect ?? w / h;
    if (!portrait && aspect < R.minWideAspect) {
      issues.push(
        issue(
          "not_wide",
          "warn",
          "This video is narrower than 16:9, so it may not show the whole pitch.",
        ),
      );
    }
    const minutes = durationSec / 60;
    if (
      durationSec >= R.minDurationSec &&
      minutes < matchLengthMin(halfLengthMinutes) - R.durationSlackMin
    ) {
      issues.push(
        issue(
          "duration_short",
          "warn",
          `This video is ${wholeMinutes(durationSec)} min long. A match of 2 × ${halfLengthMinutes} min usually runs longer.`,
        ),
      );
    } else if (minutes > R.maxDurationMin) {
      issues.push(
        issue(
          "duration_long",
          "warn",
          `This video is ${wholeMinutes(durationSec)} min long, longer than a match.`,
        ),
      );
    }
  }
  const verdict: FootageVerdict = issues.some((i) => i.severity === "reject")
    ? "rejected"
    : issues.length > 0
      ? "accepted_with_warnings"
      : "accepted";
  return { verdict, issues };
}

/** Reads a stored Video.validation; anything unexpected is treated as no result. */
export function readValidation(value: unknown): FootageValidation | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<FootageValidation>;
  if (!v.verdict || !Array.isArray(v.issues)) return null;
  return { verdict: v.verdict, issues: v.issues };
}
