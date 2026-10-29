// No "server-only" marker: the worker (plain Node, src/worker/) runs this.
import type { Prisma } from "@/generated/prisma/client";
import type { ProcessingJobType } from "@/generated/prisma/enums";
import { fromStatusesFor } from "../matches/status";

/**
 * When a match is review-ready (C08; MATCH07): every required processing job
 * of its accepted video has succeeded. The transcode and cv jobs run in
 * parallel, so each one's success transaction calls this; the Match row lock
 * serialises them, so the second to finish always sees the first and the
 * match never stays in Processing. C09 appends "clips".
 */
export const REQUIRED_JOB_TYPES: readonly ProcessingJobType[] = ["transcode", "cv"];

/**
 * Moves the match Processing to Awaiting review if every required job of the
 * video has succeeded. Call it inside the transaction that marks a job
 * succeeded. Returns true when the match moved.
 */
export async function moveToAwaitingReviewIfReady(
  tx: Prisma.TransactionClient,
  {
    organisationId,
    matchId,
    videoId,
  }: { organisationId: string; matchId: string; videoId: string },
): Promise<boolean> {
  await tx.$queryRaw`
    SELECT 1 FROM "Match" WHERE "id" = ${matchId} AND "organisationId" = ${organisationId} FOR UPDATE`;
  const jobs = await tx.processingJob.findMany({
    where: { organisationId, matchId, videoId, type: { in: [...REQUIRED_JOB_TYPES] } },
    select: { type: true, status: true },
  });
  const ready = REQUIRED_JOB_TYPES.every((type) =>
    jobs.some((j) => j.type === type && j.status === "succeeded"),
  );
  if (!ready) return false;
  const { count } = await tx.match.updateMany({
    where: {
      id: matchId,
      organisationId,
      status: { in: fromStatusesFor("awaiting_review") },
    },
    data: { status: "awaiting_review" },
  });
  return count === 1;
}
