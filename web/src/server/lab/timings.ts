// Pure. NFR01: upload to review-ready in 4 hours or less.
import type { ProcessingJobStatus, ProcessingJobType } from "@/generated/prisma/enums";
import { REQUIRED_JOB_TYPES } from "../processing/readiness";

export const REVIEW_READY_TARGET_SEC = 4 * 3600;

type JobTiming = { type: ProcessingJobType; status: ProcessingJobStatus; finishedAt: Date | null };

/**
 * Seconds from the upload finishing to the match being review-ready: the
 * latest finishedAt of the required jobs (transcode, cv, clips) minus
 * Video.uploadedAt. Null until every required job has succeeded.
 */
export function reviewReadyDuration(
  uploadedAt: Date | null,
  jobs: readonly JobTiming[],
): number | null {
  if (!uploadedAt) return null;
  let last = 0;
  for (const type of REQUIRED_JOB_TYPES) {
    const job = jobs.find((j) => j.type === type && j.status === "succeeded" && j.finishedAt);
    if (!job) return null;
    last = Math.max(last, job.finishedAt!.getTime());
  }
  return Math.max(0, (last - uploadedAt.getTime()) / 1000);
}
