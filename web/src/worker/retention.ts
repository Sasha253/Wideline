import {
  AbortMultipartUploadCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { log } from "../server/log";
import type { RetentionJob } from "../server/queue";
import { bucket, s3Internal } from "../server/storage";
import { recordUsage, storageBytesForMatch } from "../server/usage/meter";

/**
 * The retention queue (NFR32, MATCH08): the one process that deletes footage.
 * C06 handles match_deleted: abort the match's open multipart uploads, delete
 * every object under orgs/{org}/matches/{match}/ (raw footage now; HLS and
 * clips from C07 and C09), and net its storage off the usage meter. C17 adds
 * the daily raw-footage and clip sweep to this queue.
 *
 * Idempotent: deleting nothing is fine, an aborted upload stays aborted, and
 * the negative storage row has a fixed source (MatchDeletion, the match id),
 * so a retry records nothing more (NFR06). Logs carry ids only.
 */

/** Same layout as src/server/matches/upload.ts matchPrefix(). */
function matchPrefix(organisationId: string, matchId: string): string {
  return `orgs/${organisationId}/matches/${matchId}/`;
}

async function abortUpload(key: string, uploadId: string): Promise<void> {
  try {
    await s3Internal().send(
      new AbortMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: uploadId }),
    );
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name !== "NoSuchUpload") throw err;
  }
}

/** Deletes every object under a prefix, 1000 at a time. Returns how many it deleted. */
export async function deletePrefix(prefix: string): Promise<number> {
  let deleted = 0;
  let token: string | undefined;
  do {
    const page = await s3Internal().send(
      new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }),
    );
    const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (keys.length) {
      const res = await s3Internal().send(
        new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: keys, Quiet: true } }),
      );
      if (res.Errors?.length) throw new Error(`DeleteObjects failed for ${res.Errors.length} keys`);
      deleted += keys.length;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}

export async function handleRetention(job: RetentionJob): Promise<void> {
  if (job.kind !== "match_deleted") {
    log.warn({ kind: (job as { kind?: string }).kind }, "retention job of an unknown kind");
    return;
  }
  const { organisationId, matchId } = job;
  for (const u of job.uploads) await abortUpload(u.key, u.uploadId);
  const deleted = await deletePrefix(matchPrefix(organisationId, matchId));
  const stored = await storageBytesForMatch(organisationId, matchId);
  if (stored > BigInt(0)) {
    await recordUsage({
      organisationId,
      metric: "storage_bytes",
      quantity: -stored,
      sourceType: "MatchDeletion",
      sourceId: matchId,
      metadata: { matchId },
    });
  }
  log.info(
    { organisationId, matchId, objectsDeleted: deleted, uploadsAborted: job.uploads.length },
    "match storage purged",
  );
}
