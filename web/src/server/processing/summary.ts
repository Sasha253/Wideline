import "server-only";
import type { ProcessingJobStatus } from "@/generated/prisma/enums";
import type { AuthContext } from "../auth/session";
import { requireSquadOrg } from "../matches/access";
import { estimatedReadyAt } from "../matches/estimate";
import { transcodeTimings } from "./timings";

/**
 * What the match page shows about processing (MATCH07, NFR31 as plain status;
 * docs/build/design/C07.md, Surface 2): the transcode job's state and attempt
 * count, and the estimated finish from measured timings. Read through the
 * scoped client. Never carries errorMessage: technical error text is not for
 * clubs.
 */

export type TranscodeStep = {
  status: ProcessingJobStatus;
  attempts: number;
  maxAttempts: number;
  startedAt: Date | null;
  finishedAt: Date | null;
};

export type ProcessingSummary = {
  /** The accepted video's transcode job, or null (none yet, or accepted before C07). */
  transcode: TranscodeStep | null;
  /** The estimated finish, or null before the probe has run. */
  readyAt: Date | null;
};

/** The processing summary for the match's accepted video, or null when it has none. */
export async function processingSummary(
  ctx: AuthContext,
  matchId: string,
): Promise<ProcessingSummary | null> {
  requireSquadOrg(ctx);
  const video = await ctx.db.video.findFirst({
    where: { matchId, status: "accepted" },
    select: { id: true, probedAt: true, durationSec: true },
  });
  if (!video) return null;
  const [transcode, timings] = await Promise.all([
    ctx.db.processingJob.findFirst({
      where: { matchId, videoId: video.id, type: "transcode" },
      select: {
        status: true,
        attempts: true,
        maxAttempts: true,
        startedAt: true,
        finishedAt: true,
      },
    }),
    transcodeTimings(),
  ]);
  return { transcode, readyAt: estimatedReadyAt(video, timings) };
}
