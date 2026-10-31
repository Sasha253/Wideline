// No "server-only" marker: the worker's review sweep (plain Node) sends these.
import { formatDeletionDate, formatTimeLeft } from "@/components/ui/expiry";
import { formatDateTime } from "@/lib/labels";
import { REVIEW_ALERT_LEAD_MS } from "@/lib/review-rules";
import { rawDb } from "../db/raw";
import { log } from "../log";
import { deliverMail } from "../mail-transport";
import { platformAdminEmails } from "../processing/alerts";

/**
 * REVIEW13 (A-13): platform admins are told when an unreviewed match (Awaiting
 * review or In review) has 48 hours or less of raw footage left. One email
 * per video to every platform admin, sent once: Video.reviewAlertedAt is
 * claimed with a guarded update first, and given back when the mail fails, so
 * the next sweep retries (the C08 alert mechanics). The email carries ids,
 * the deletion date and the claim state, never team or player names. Draft
 * copy. Returns how many videos it alerted.
 */
export async function alertExpiringReviews(now: Date = new Date()): Promise<number> {
  const videos = await rawDb.video.findMany({
    where: {
      status: "accepted",
      deletedAt: null,
      reviewAlertedAt: null,
      rawExpiresAt: { gt: now, lte: new Date(now.getTime() + REVIEW_ALERT_LEAD_MS) },
      match: {
        status: { in: ["awaiting_review", "in_review"] },
        organisation: { status: "active", type: { in: ["academy", "club"] } },
      },
    },
    select: { id: true, organisationId: true, matchId: true, rawExpiresAt: true },
    orderBy: { rawExpiresAt: "asc" },
  });
  let alerted = 0;
  for (const v of videos) {
    if (await alertOne({ ...v, rawExpiresAt: v.rawExpiresAt! }, now)) alerted++;
  }
  return alerted;
}

async function alertOne(
  v: { id: string; organisationId: string; matchId: string; rawExpiresAt: Date },
  now: Date,
): Promise<boolean> {
  const claimedAt = now;
  let claimed = false;
  try {
    const { count } = await rawDb.video.updateMany({
      where: { id: v.id, organisationId: v.organisationId, reviewAlertedAt: null },
      data: { reviewAlertedAt: claimedAt },
    });
    if (count === 0) return false;
    claimed = true;
    const claim = await rawDb.reviewClaim.findFirst({
      where: { matchId: v.matchId, organisationId: v.organisationId, status: "active" },
      select: { id: true, expiresAt: true },
    });
    const appUrl = process.env.APP_URL ?? "http://wideline.localhost";
    const left = formatTimeLeft(v.rawExpiresAt.getTime() - now.getTime());
    const subject = `Unreviewed match footage is deleted in ${left}`;
    const text = [
      `The raw footage of a match nobody has finished reviewing is deleted on ${formatDeletionDate(v.rawExpiresAt)} (${formatDateTime(v.rawExpiresAt)}, South African time). After that, missed events can no longer be added.`,
      claim
        ? `A scout holds the match until ${formatDateTime(claim.expiresAt)} (claim ${claim.id}).`
        : "No scout has claimed it.",
      `Match: ${v.matchId}`,
      `Organisation: ${v.organisationId}`,
      `Video: ${v.id}`,
      `Admin area: ${appUrl}/admin`,
      "The Wideline team",
    ].join("\n\n");
    const emails = await platformAdminEmails();
    for (const to of emails) await deliverMail(to, subject, text);
    log.warn(
      {
        event: "review_expiry_alerted",
        videoId: v.id,
        matchId: v.matchId,
        organisationId: v.organisationId,
        claimed: claim !== null,
        recipients: emails.length,
      },
      "review expiry alert",
    );
    return true;
  } catch (err) {
    log.error({ err, videoId: v.id }, "review expiry alert failed");
    if (claimed) {
      await rawDb.video
        .updateMany({
          where: { id: v.id, organisationId: v.organisationId, reviewAlertedAt: claimedAt },
          data: { reviewAlertedAt: null },
        })
        .catch((e: unknown) => log.error({ err: e, videoId: v.id }, "review alert claim kept"));
    }
    return false;
  }
}
