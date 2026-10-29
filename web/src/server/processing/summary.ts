import "server-only";
import type { ProcessingJobStatus } from "@/generated/prisma/enums";
import type { AuthContext } from "../auth/session";
import { requireSquadOrg } from "../matches/access";
import { estimatedReadyAt } from "../matches/estimate";
import { processingTimings } from "./timings";

/**
 * What the match page shows about processing (MATCH07, NFR31 as plain status;
 * docs/build/design/C07.md, Surface 2): the transcode and CV jobs' states and
 * attempt counts, and the estimated finish from measured timings. Read through
 * the scoped client. Never carries errorMessage: technical error text is not
 * for clubs.
 */

export type ProcessingStep = {
  status: ProcessingJobStatus;
  attempts: number;
  maxAttempts: number;
  startedAt: Date | null;
  finishedAt: Date | null;
};

export type ProcessingSummary = {
  /** The accepted video's transcode job, or null (none yet, or accepted before C07). */
  transcode: ProcessingStep | null;
  /** The accepted video's CV job, or null (accepted before C08). */
  cv: ProcessingStep | null;
  /** The estimated finish, or null before the probe has run. */
  readyAt: Date | null;
};

const STEP_SELECT = {
  type: true,
  status: true,
  attempts: true,
  maxAttempts: true,
  startedAt: true,
  finishedAt: true,
} as const;

/** The processing summary for the match's accepted video, or null when it has none. */
export async function processingSummary(
  ctx: AuthContext,
  matchId: string,
): Promise<ProcessingSummary | null> {
  requireSquadOrg(ctx);
  const video = await ctx.db.video.findFirst({
    // A deleted video in its 7-day hold is not processing (as playableVideo).
    where: { matchId, status: "accepted", deletedAt: null },
    select: { id: true, probedAt: true, durationSec: true },
  });
  if (!video) return null;
  const [jobs, timings] = await Promise.all([
    ctx.db.processingJob.findMany({
      where: { matchId, videoId: video.id, type: { in: ["transcode", "cv"] } },
      select: STEP_SELECT,
    }),
    processingTimings(),
  ]);
  const step = (type: "transcode" | "cv"): ProcessingStep | null => {
    const job = jobs.find((j) => j.type === type);
    if (!job) return null;
    return {
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    };
  };
  return {
    transcode: step("transcode"),
    cv: step("cv"),
    readyAt: estimatedReadyAt(video, timings),
  };
}
