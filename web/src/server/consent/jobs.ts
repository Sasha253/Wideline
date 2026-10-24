import "server-only";
import { log } from "../log";
import { getBoss, QUEUES, type ConsentWithdrawnJob } from "../queue";

/**
 * Enqueues the consent-withdrawn job after a change commits that takes
 * visibility away (a withdrawal, or scouts yes to no). NFR11: live queries
 * change at once through consentVisibleTo(); this job is for derived artefacts
 * (clips, search indexes, cached exports), which later chunks purge within 24
 * hours. A failure is logged and never fails the change itself: the consent row
 * is already saved. Ids only, never names.
 */
export async function enqueueConsentWithdrawn(job: ConsentWithdrawnJob): Promise<void> {
  try {
    const boss = await getBoss();
    await boss.send(QUEUES.consentWithdrawn, job);
  } catch (err) {
    log.error({ err, ...job }, "consent-withdrawn enqueue failed");
  }
}
