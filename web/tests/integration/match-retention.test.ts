import { randomBytes } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { rawDb } from "@/server/db/raw";
import { deleteMatch } from "@/server/matches/matches";
import { MatchError } from "@/server/matches/errors";
import { completeUpload, matchPrefix, presignParts, startUpload } from "@/server/matches/upload";
import type { RetentionJob } from "@/server/queue";
import { bucket, s3Internal } from "@/server/storage";
import { storageBytesForMatch } from "@/server/usage/meter";
import { deletePrefix, handleRetention } from "@/worker/retention";
import { fixtures } from "./helpers/fixtures";
import { match, setupClub, storageAvailable } from "./helpers/matches";

// MATCH08, NFR32, ADMIN05: deleting a match purges its storage through the
// retention queue, not before its raw footage is 7 days old (Q-025), and nets
// its storage off the usage meter once. Against the compose stack's RustFS;
// skipped where none answers (CI), with a warning.

const boss = vi.hoisted(() => ({
  send: vi.fn<(queue: string, job: unknown, options?: { startAfter?: Date }) => Promise<string>>(
    async () => "job-id",
  ),
}));
vi.mock("@/server/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/queue")>()),
  getBoss: async () => boss,
}));

const MiB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const hasStorage = await storageAvailable();
if (!hasStorage) console.warn("match-retention: skipped, no object storage answers (RustFS)");
const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;

beforeAll(async () => {
  if (!hasStorage) return;
  club = await setupClub(f, "Retention FC");
});

afterAll(async () => {
  if (hasStorage && club) await deletePrefix(`orgs/${club.org.id}/`);
  await f.cleanup();
});

const list = async (prefix: string) =>
  (await s3Internal().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix })))
    .Contents ?? [];

async function uploadAll(matchId: string, bytes: Buffer, lastModified: number) {
  const info = await startUpload(club.ctx, matchId, {
    fileName: "match.mp4",
    size: bytes.length,
    type: "video/mp4",
    lastModified,
  });
  const urls = await presignParts(club.ctx, matchId, { videoId: info.videoId, partNumbers: [1] });
  const res = await fetch(urls[1]!, { method: "PUT", body: new Uint8Array(bytes) });
  expect(res.status).toBe(200);
  return info;
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** The one retention job deleteMatch sent, with its options. */
function sentRetention() {
  const calls = boss.send.mock.calls.filter(([queue]) => queue === "retention");
  expect(calls).toHaveLength(1);
  const [, job, options] = calls[0]!;
  return { job: job as RetentionJob, startAfter: options?.startAfter };
}

describe.skipIf(!hasStorage)("match_deleted retention", { timeout: 60_000 }, () => {
  it("keeps a 2-day-old match's footage until 7 days after upload, then removes it all", async () => {
    // A completed upload two days ago (recorded in the meter), plus a later artefact (HLS, C07).
    const { id: done } = await match(club.ctx, club.own.id, club.opposition.id);
    const bytes = randomBytes(MiB);
    const info = await uploadAll(done, bytes, 1);
    const uploadedAt = new Date(Date.now() - 2 * DAY);
    await completeUpload(club.ctx, done, info.videoId, uploadedAt);
    const { rawExpiresAt } = await rawDb.video.findUniqueOrThrow({ where: { id: info.videoId } });
    expect(rawExpiresAt!.getTime()).toBe(uploadedAt.getTime() + 7 * DAY);
    const prefix = matchPrefix(club.org.id, done);
    await s3Internal().send(
      new PutObjectCommand({ Bucket: bucket(), Key: `${prefix}hls/master.m3u8`, Body: "#EXTM3U" }),
    );
    expect(await list(prefix)).toHaveLength(2);
    expect(await storageBytesForMatch(club.org.id, done)).toBe(BigInt(MiB));

    // The match is gone for the club at once; the purge is scheduled for rawExpiresAt.
    boss.send.mockClear();
    await deleteMatch(club.ctx, done);
    expect(await rawDb.match.count({ where: { id: done } })).toBe(0);
    expect(await rawDb.auditLog.count({ where: { action: "match.deleted", targetId: done } })).toBe(
      1,
    );
    const { job, startAfter } = sentRetention();
    expect(startAfter).toEqual(rawExpiresAt);
    expect(job).toMatchObject({
      kind: "match_deleted",
      organisationId: club.org.id,
      matchId: done,
      prefix,
      rawExpiresAt: rawExpiresAt!.toISOString(),
      uploads: [],
    });
    expect(await list(prefix)).toHaveLength(2);

    // Run early (now, 5 days before expiry): deletes nothing and sends itself again.
    boss.send.mockClear();
    expect(await handleRetention(job)).toBe("deferred");
    expect(await list(prefix)).toHaveLength(2);
    const again = sentRetention();
    expect(again.startAfter).toEqual(rawExpiresAt);
    expect(again.job).toMatchObject({ matchId: done, rawExpiresAt: job.rawExpiresAt });
    expect(await storageBytesForMatch(club.org.id, done)).toBe(BigInt(MiB));

    // A second before expiry still keeps it.
    expect(await handleRetention(job, new Date(rawExpiresAt!.getTime() - 1000))).toBe("deferred");
    expect(await list(prefix)).toHaveLength(2);

    // At 7 days it deletes everything under the prefix and nets storage off once.
    boss.send.mockClear();
    expect(await handleRetention(job, rawExpiresAt!)).toBe("purged");
    expect(boss.send).not.toHaveBeenCalled();
    expect(await list(prefix)).toEqual([]);
    const rows = await rawDb.usageEvent.findMany({
      where: { organisationId: club.org.id, metric: "storage_bytes", sourceType: "MatchDeletion" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ quantity: BigInt(-MiB), sourceId: done });
    expect(await storageBytesForMatch(club.org.id, done)).toBe(BigInt(0));

    // A retry after that deletes nothing more and records nothing more.
    expect(await handleRetention(job, new Date(rawExpiresAt!.getTime() + DAY))).toBe("purged");
    expect(
      await rawDb.usageEvent.count({
        where: { organisationId: club.org.id, sourceType: "MatchDeletion", sourceId: done },
      }),
    ).toBe(1);
  });

  it("refuses a job whose prefix is not the match's own", async () => {
    const job: RetentionJob = {
      kind: "match_deleted",
      organisationId: club.org.id,
      matchId: "m1",
      uploads: [],
      prefix: "orgs/",
      rawExpiresAt: null,
    };
    await expect(handleRetention(job)).rejects.toThrow(/not a match prefix/);
  });

  it("aborts a match's open multipart upload at once and purges at once", async () => {
    const { id: open } = await match(club.ctx, club.own.id, club.opposition.id);
    const info = await uploadAll(open, randomBytes(MiB), 2);
    const video = await rawDb.video.findUniqueOrThrow({ where: { id: info.videoId } });

    boss.send.mockClear();
    const before = Date.now();
    await deleteMatch(club.ctx, open);
    const { job, startAfter } = sentRetention();
    expect(job.uploads).toEqual([{ key: video.blobPath, uploadId: video.s3UploadId }]);
    expect(job.rawExpiresAt).toBeNull();
    expect(startAfter!.getTime()).toBeGreaterThanOrEqual(before);
    expect(startAfter!.getTime()).toBeLessThanOrEqual(Date.now());

    // Aborted by deleteMatch itself: the parts are not raw footage.
    const listParts = () =>
      s3Internal().send(
        new ListPartsCommand({
          Bucket: bucket(),
          Key: video.blobPath,
          UploadId: video.s3UploadId!,
        }),
      );
    await expect(listParts()).rejects.toMatchObject({ name: "NoSuchUpload" });
    expect(await handleRetention(job)).toBe("purged");
    await expect(listParts()).rejects.toMatchObject({ name: "NoSuchUpload" });
    // Nothing was ever recorded for an upload that never completed.
    expect(
      await rawDb.usageEvent.count({ where: { sourceType: "MatchDeletion", sourceId: open } }),
    ).toBe(0);
  });

  it("removes a raw file whose upload completes after the purge listed the prefix", async () => {
    const { id: racing } = await match(club.ctx, club.own.id, club.opposition.id);
    const info = await uploadAll(racing, randomBytes(MiB), 3);
    const prefix = matchPrefix(club.org.id, racing);
    const client = s3Internal();
    const send = client.send.bind(client) as (cmd: unknown) => Promise<unknown>;
    let job: RetentionJob | undefined;
    vi.spyOn(client, "send").mockImplementation((async (cmd: unknown) => {
      if (cmd instanceof CompleteMultipartUploadCommand && !job) {
        // The club deletes the match while CompleteMultipartUpload is in flight.
        // The abort is lost (S3 down for a moment), and the purge runs first:
        // the prefix holds no object yet, so it deletes nothing.
        boss.send.mockClear();
        await deleteMatch(club.ctx, racing);
        job = sentRetention().job;
        expect(job.rawExpiresAt).toBeNull();
        expect(await handleRetention({ ...job, uploads: [] })).toBe("purged");
      }
      if (cmd instanceof AbortMultipartUploadCommand) return {};
      return send(cmd);
    }) as typeof client.send);

    const err = await completeUpload(club.ctx, racing, info.videoId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MatchError);
    expect(err).toMatchObject({ code: "upload_gone" });
    vi.restoreAllMocks();

    // completeUpload removed the object it completed for the deleted match.
    expect(await list(prefix)).toEqual([]);
    // The retention job's delayed run then finds nothing.
    expect(await handleRetention(job!)).toBe("purged");
    expect(await list(prefix)).toEqual([]);
    expect(await rawDb.usageEvent.count({ where: { sourceId: info.videoId } })).toBe(0);
  });
});
