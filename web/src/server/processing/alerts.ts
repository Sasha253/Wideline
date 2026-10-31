// No "server-only" marker: the worker (plain Node, src/worker/) sends these.
import { rawDb } from "../db/raw";
import { log } from "../log";
import { deliverMail } from "../mail-transport";
import type { JobRef } from "./jobs";

/**
 * Every accepted platform_admin of the platform organisation, once each. Also
 * the recipients of the review expiry alert (C10, src/server/review/alerts.ts).
 */
export async function platformAdminEmails(): Promise<string[]> {
  const admins = await rawDb.membership.findMany({
    where: {
      role: "platform_admin",
      acceptedAt: { not: null },
      organisation: { type: "platform" },
    },
    select: { user: { select: { email: true } } },
  });
  return [...new Set(admins.map((a) => a.user.email))];
}

/**
 * NFR30: a platform admin is told when a processing job fails for good. One
 * plain email per job to every accepted platform_admin of the platform
 * organisation, sent once: ProcessingJob.alertedAt is claimed with a guarded
 * update first, so a retried path or the watchdog never sends it twice. The
 * email carries ids, the job type, attempts and a link to the admin area, never
 * names or footage. It never throws: a mail failure is logged and the claim
 * is given back, and the cv watchdog sends it again within 24 hours
 * (src/worker/cv-watchdog.ts); the job's own failure still stands. C18 adds the admin view with a retry.
 */
export async function alertPlatformAdmins(job: JobRef, reason: string): Promise<boolean> {
  const claimedAt = new Date();
  let claimed = false;
  try {
    const { count } = await rawDb.processingJob.updateMany({
      where: { id: job.id, organisationId: job.organisationId, alertedAt: null },
      data: { alertedAt: claimedAt },
    });
    if (count === 0) return false;
    claimed = true;
    const appUrl = process.env.APP_URL ?? "http://wideline.localhost";
    const subject = `Processing failed: ${job.type} job ${job.id}`;
    const text = [
      `A ${job.type} job failed after ${job.attempts} of ${job.maxAttempts} attempts and will not be retried.`,
      `Reason: ${reason}.`,
      `Job: ${job.id}`,
      `Match: ${job.matchId}`,
      `Organisation: ${job.organisationId}`,
      `The error is on the job row and in the logs (processingJobId ${job.id}).`,
      `Admin area: ${appUrl}/admin`,
      "The Wideline team",
    ].join("\n\n");
    const emails = await platformAdminEmails();
    for (const to of emails) await deliverMail(to, subject, text);
    log.error(
      {
        event: "alerted",
        processingJobId: job.id,
        type: job.type,
        organisationId: job.organisationId,
        matchId: job.matchId,
        recipients: emails.length,
      },
      "processing job alert",
    );
    return true;
  } catch (err) {
    log.error({ err, processingJobId: job.id }, "processing job alert failed");
    if (claimed) {
      await rawDb.processingJob
        .updateMany({
          where: { id: job.id, organisationId: job.organisationId, alertedAt: claimedAt },
          data: { alertedAt: null },
        })
        .catch((e: unknown) => log.error({ err: e, processingJobId: job.id }, "alert claim kept"));
    }
    return false;
  }
}
