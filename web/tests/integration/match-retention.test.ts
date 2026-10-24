import { randomBytes } from "node:crypto";
import { ListObjectsV2Command, ListPartsCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rawDb } from "@/server/db/raw";
import { deleteMatch } from "@/server/matches/matches";
import { completeUpload, matchPrefix, presignParts, startUpload } from "@/server/matches/upload";
import type { RetentionJob } from "@/server/queue";
import { bucket, s3Internal } from "@/server/storage";
import { storageBytesForMatch } from "@/server/usage/meter";
import { deletePrefix, handleRetention } from "@/worker/retention";
import { fixtures } from "./helpers/fixtures";
import { match, setupClub, storageAvailable } from "./helpers/matches";

// MATCH08, NFR32, ADMIN05: deleting a match purges its storage through the
// retention queue, and nets its storage off the usage meter once. Against the
// compose stack's RustFS; skipped where none answers (CI).

const boss = vi.hoisted(() => ({
  send: vi.fn<(queue: string, job: unknown) => Promise<string>>(async () => "job-id"),
}));
vi.mock("@/server/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/queue")>()),
  getBoss: async () => boss,
}));

const MiB = 1024 * 1024;
const hasStorage = await storageAvailable();
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
  await fetch(urls[1]!, { method: "PUT", body: new Uint8Array(bytes) });
  return info;
}

describe.skipIf(!hasStorage)("match_deleted retention", () => {
  it("removes every object, aborts open uploads and nets storage off once", async () => {
    // A completed upload (recorded in the meter), plus a later artefact (HLS, C07).
    const { id: done } = await match(club.ctx, club.own.id, club.opposition.id);
    const bytes = randomBytes(MiB);
    const info = await uploadAll(done, bytes, 1);
    await completeUpload(club.ctx, done, info.videoId);
    const prefix = matchPrefix(club.org.id, done);
    await s3Internal().send(
      new PutObjectCommand({ Bucket: bucket(), Key: `${prefix}hls/master.m3u8`, Body: "#EXTM3U" }),
    );
    expect(await list(prefix)).toHaveLength(2);
    expect(await storageBytesForMatch(club.org.id, done)).toBe(BigInt(MiB));

    boss.send.mockClear();
    await deleteMatch(club.ctx, done);
    const [queue, job] = boss.send.mock.calls[0]! as [string, RetentionJob];
    expect(queue).toBe("retention");
    await handleRetention(job);

    expect(await list(prefix)).toEqual([]);
    const rows = await rawDb.usageEvent.findMany({
      where: { organisationId: club.org.id, metric: "storage_bytes", sourceType: "MatchDeletion" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ quantity: BigInt(-MiB), sourceId: done });
    expect(await storageBytesForMatch(club.org.id, done)).toBe(BigInt(0));

    // A retry deletes nothing more and records nothing more.
    await handleRetention(job);
    expect(
      await rawDb.usageEvent.count({
        where: { organisationId: club.org.id, sourceType: "MatchDeletion", sourceId: done },
      }),
    ).toBe(1);
  });

  it("aborts a match's open multipart upload", async () => {
    const { id: open } = await match(club.ctx, club.own.id, club.opposition.id);
    const info = await uploadAll(open, randomBytes(MiB), 2);
    const video = await rawDb.video.findUniqueOrThrow({ where: { id: info.videoId } });

    boss.send.mockClear();
    await deleteMatch(club.ctx, open);
    const [, job] = boss.send.mock.calls[0]! as [string, RetentionJob];
    expect(job.uploads).toEqual([{ key: video.blobPath, uploadId: video.s3UploadId }]);
    await handleRetention(job);

    await expect(
      s3Internal().send(
        new ListPartsCommand({
          Bucket: bucket(),
          Key: video.blobPath,
          UploadId: video.s3UploadId!,
        }),
      ),
    ).rejects.toThrow();
    // Nothing was ever recorded for an upload that never completed.
    expect(
      await rawDb.usageEvent.count({ where: { sourceType: "MatchDeletion", sourceId: open } }),
    ).toBe(0);
  });
});
