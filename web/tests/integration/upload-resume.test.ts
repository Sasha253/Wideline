import { randomBytes, randomUUID } from "node:crypto";
import { HeadObjectCommand, ListPartsCommand } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MultipartUploader,
  type Clock,
  type Connectivity,
  type FetchLike,
} from "@/lib/upload/multipart-client";
import type { AuthContext } from "@/server/auth/session";
import { rawDb } from "@/server/db/raw";
import { MatchError } from "@/server/matches/errors";
import { errorResponse } from "@/server/matches/http";
import { getMatch } from "@/server/matches/matches";
import {
  cancelUpload,
  completeUpload,
  presignParts,
  startUpload,
  uploadStatus,
} from "@/server/matches/upload";
import { bucket, s3Internal } from "@/server/storage";
import { deletePrefix } from "@/worker/retention";
import { fixtures } from "./helpers/fixtures";
import { jobsFor, match, setupClub, storageAvailable } from "./helpers/matches";

// C06 acceptance (MATCH02, NFR26): an upload interrupted at about 50% resumes
// without restarting. Against the compose stack's RustFS through presigned
// URLs, with the real browser uploader. Skipped where no object storage
// answers (CI has none; see STATUS.md).

const boss = vi.hoisted(() => ({ send: vi.fn(async () => "job-id") }));
vi.mock("@/server/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/queue")>()),
  getBoss: async () => boss,
}));

// recordUsage, failing on demand: a failure after the upload committed.
const meter = vi.hoisted(() => ({ failNext: false }));
vi.mock("@/server/usage/meter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/usage/meter")>();
  return {
    ...actual,
    recordUsage: async (...args: Parameters<typeof actual.recordUsage>) => {
      if (meter.failNext) {
        meter.failNext = false;
        throw new Error("database went away");
      }
      return actual.recordUsage(...args);
    },
  };
});

const MiB = 1024 * 1024;
// 17 MiB: parts of 8, 8 and 1 MiB, so part 1 is 47%.
const SIZE = 17 * MiB;
const bytes = randomBytes(SIZE);
const fileMeta = {
  fileName: "match-final.mp4",
  size: SIZE,
  type: "video/mp4",
  lastModified: 1_760_000_000_000,
};

const hasStorage = await storageAvailable();
if (!hasStorage) console.warn("upload-resume: skipped, no object storage answers (RustFS)");
const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;

beforeAll(async () => {
  if (!hasStorage) return;
  club = await setupClub(f, "Upload FC");
});

afterAll(async () => {
  if (hasStorage && club) await deletePrefix(`orgs/${club.org.id}/`);
  await f.cleanup();
});

beforeEach(() => boss.send.mockClear());

async function put(url: string, body: Buffer) {
  const res = await fetch(url, { method: "PUT", body: new Uint8Array(body) });
  expect(res.status).toBe(200);
}

/** The uploader's API calls go to the services directly; storage PUTs go to RustFS. */
function serviceFetch(ctx: AuthContext, matchId: string, puts: number[]): FetchLike {
  return async (url, init) => {
    const method = init?.method ?? "GET";
    const base = `/api/matches/${matchId}/upload`;
    const body = url.startsWith(base) && init?.body ? JSON.parse(String(init.body)) : {};
    try {
      if (url === base && method === "POST") {
        return Response.json({ video: await startUpload(ctx, matchId, body) });
      }
      if (url === `${base}/parts`) {
        return Response.json({ urls: await presignParts(ctx, matchId, body) });
      }
      if (url === `${base}/complete`) {
        return Response.json(await completeUpload(ctx, matchId, body.videoId));
      }
    } catch (err) {
      return errorResponse(err, "test");
    }
    puts.push(Number(new URL(url).searchParams.get("partNumber")));
    return fetch(url, init);
  };
}

const instantClock: Clock = { now: () => Date.now(), sleep: async () => {} };
const online: Connectivity = { isOnline: () => true, subscribe: () => () => {} };

describe.skipIf(!hasStorage)("resumable upload against RustFS", { timeout: 60_000 }, () => {
  it("resumes from part 1 of 3 without sending it again, then completes once", async () => {
    const { id: matchId } = await match(club.coachCtx, club.own.id, club.opposition.id);

    // First session: start, send part 1 (47%), then the connection drops.
    const started = await startUpload(club.coachCtx, matchId, fileMeta);
    expect(started).toMatchObject({ partCount: 3, partSize: 8 * MiB, uploadedParts: [] });
    expect((await getMatch(club.ctx, matchId)).status).toBe("uploading");
    const urls = await presignParts(club.coachCtx, matchId, {
      videoId: started.videoId,
      partNumbers: [1],
    });
    await put(urls[1]!, bytes.subarray(0, 8 * MiB));

    // The server knows what arrived (ListParts), whoever asks.
    const status = await uploadStatus(club.ctx, matchId);
    expect(status?.uploadedParts).toEqual([{ partNumber: 1, size: 8 * MiB }]);
    expect(Math.floor((status!.uploadedBytes / SIZE) * 100)).toBe(47);

    // Second session: a new uploader with the same file resumes.
    const puts: number[] = [];
    const file = Object.assign(new Blob([bytes]), {
      name: fileMeta.fileName,
      lastModified: fileMeta.lastModified,
    });
    const end = await new MultipartUploader({
      matchId,
      file,
      fetch: serviceFetch(club.coachCtx, matchId, puts),
      clock: instantClock,
      connectivity: online,
      storage: null,
    }).start();
    expect(end.phase).toBe("complete");
    expect(end.resumedFromPercent).toBe(47);
    expect(puts.sort()).toEqual([2, 3]);

    const video = await rawDb.video.findUniqueOrThrow({ where: { id: started.videoId } });
    expect(video).toMatchObject({ status: "probing", s3UploadId: null });
    expect(video.rawExpiresAt!.getTime() - video.uploadedAt!.getTime()).toBe(7 * 24 * 3600 * 1000);
    const head = await s3Internal().send(
      new HeadObjectCommand({ Bucket: bucket(), Key: video.blobPath }),
    );
    expect(head.ContentLength).toBe(SIZE);

    // Completing again changes nothing: one storage row, one probe job (the
    // send is repeated with the same job id, which pg-boss ignores).
    expect(await completeUpload(club.coachCtx, matchId, started.videoId)).toEqual({
      status: "probing",
      alreadyComplete: true,
    });
    const usage = await rawDb.usageEvent.findMany({
      where: { organisationId: club.org.id, metric: "storage_bytes", sourceId: started.videoId },
    });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ quantity: BigInt(SIZE), sourceType: "Video" });
    expect(usage[0]!.metadata).toEqual({ matchId });
    expect(boss.send).toHaveBeenCalledTimes(2);
    for (const call of boss.send.mock.calls as unknown[][]) {
      expect(call).toEqual([
        "probe",
        { organisationId: club.org.id, videoId: started.videoId },
        { id: started.videoId },
      ]);
    }
    const audits = await rawDb.auditLog.findMany({
      where: { targetId: started.videoId, action: { startsWith: "video." } },
    });
    expect(audits.map((a) => a.action).sort()).toEqual(["video.upload_started", "video.uploaded"]);
  });

  it("answers complete with 409 and the missing parts", async () => {
    const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
    const started = await startUpload(club.ctx, matchId, { ...fileMeta, lastModified: 2 });
    const urls = await presignParts(club.ctx, matchId, {
      videoId: started.videoId,
      partNumbers: [1, 3],
    });
    await put(urls[1]!, bytes.subarray(0, 8 * MiB));
    await put(urls[3]!, bytes.subarray(16 * MiB));
    const err = await completeUpload(club.ctx, matchId, started.videoId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MatchError);
    const res = errorResponse(err, "test");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "missing_parts", missing: [2] });
    expect(boss.send).not.toHaveBeenCalled();
  });

  it("refuses a file over upload_max_bytes at start (entitlement override)", async () => {
    const small = await setupClub(f, "Upload Small FC");
    await rawDb.entitlement.create({
      data: {
        organisationId: small.org.id,
        key: "upload_max_bytes",
        source: "override",
        value: 10_000_000,
      },
    });
    const { id: matchId } = await match(small.ctx, small.own.id, small.opposition.id);
    const err = await startUpload(small.ctx, matchId, fileMeta).catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: "upload_too_big",
      userMessage: "This file is 17 MB. The most you can upload for one match is 0.01 GB.",
    });
    expect(errorResponse(err, "test").status).toBe(413);
    expect(await rawDb.video.count({ where: { matchId } })).toBe(0);
  });

  it("refuses other file types and empty files", async () => {
    const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
    await expect(
      startUpload(club.ctx, matchId, {
        ...fileMeta,
        fileName: "match.avi",
        type: "video/x-msvideo",
      }),
    ).rejects.toMatchObject({ code: "upload_type" });
    await expect(startUpload(club.ctx, matchId, { ...fileMeta, size: 0 })).rejects.toMatchObject({
      code: "upload_empty",
    });
  });

  it("cancel aborts the multipart upload and puts the match back to Draft", async () => {
    const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
    const started = await startUpload(club.ctx, matchId, { ...fileMeta, lastModified: 3 });
    const video = await rawDb.video.findUniqueOrThrow({ where: { id: started.videoId } });
    await cancelUpload(club.coachCtx, matchId, started.videoId);
    expect(await rawDb.video.findUniqueOrThrow({ where: { id: started.videoId } })).toMatchObject({
      status: "cancelled",
      s3UploadId: null,
    });
    expect((await getMatch(club.ctx, matchId)).status).toBe("draft");
    await expect(
      s3Internal().send(
        new ListPartsCommand({
          Bucket: bucket(),
          Key: video.blobPath,
          UploadId: video.s3UploadId!,
        }),
      ),
    ).rejects.toThrow();
    expect(
      await rawDb.auditLog.count({
        where: { action: "video.upload_cancelled", targetId: started.videoId },
      }),
    ).toBe(1);
  });

  it("aborts the open upload when another file is chosen, and resumes the same file", async () => {
    const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
    const first = await startUpload(club.ctx, matchId, { ...fileMeta, lastModified: 4 });
    const again = await startUpload(club.ctx, matchId, { ...fileMeta, lastModified: 4 });
    expect(again.videoId).toBe(first.videoId);
    const other = await startUpload(club.ctx, matchId, { ...fileMeta, lastModified: 5 });
    expect(other.videoId).not.toBe(first.videoId);
    expect((await rawDb.video.findUniqueOrThrow({ where: { id: first.videoId } })).status).toBe(
      "cancelled",
    );
  });

  it("binds each part URL to the planned part size", async () => {
    const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
    const started = await startUpload(club.ctx, matchId, { ...fileMeta, lastModified: 6 });
    const urls = await presignParts(club.ctx, matchId, {
      videoId: started.videoId,
      partNumbers: [1, 3],
    });
    for (const n of [1, 3]) {
      const signed = new URL(urls[n]!).searchParams.get("X-Amz-SignedHeaders")!.split(";");
      expect(signed).toContain("content-length");
    }
    // A bigger (or smaller) body than planned is refused; the planned size goes through.
    const big = await fetch(urls[3]!, {
      method: "PUT",
      body: new Uint8Array(bytes.subarray(0, 2 * MiB)),
    });
    expect(big.status).toBe(403);
    const short = await fetch(urls[1]!, {
      method: "PUT",
      body: new Uint8Array(bytes.subarray(0, MiB)),
    });
    expect(short.status).toBe(403);
    expect((await uploadStatus(club.ctx, matchId))?.uploadedParts).toEqual([]);
    await put(urls[3]!, bytes.subarray(16 * MiB));
    expect((await uploadStatus(club.ctx, matchId))?.uploadedParts).toEqual([
      { partNumber: 3, size: MiB },
    ]);
  });

  it("records storage and enqueues the probe on a retried complete after a failure", async () => {
    const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
    const started = await startUpload(club.ctx, matchId, { ...fileMeta, lastModified: 7 });
    const urls = await presignParts(club.ctx, matchId, {
      videoId: started.videoId,
      partNumbers: [1, 2, 3],
    });
    await put(urls[1]!, bytes.subarray(0, 8 * MiB));
    await put(urls[2]!, bytes.subarray(8 * MiB, 16 * MiB));
    await put(urls[3]!, bytes.subarray(16 * MiB));

    // The upload commits, then recording usage fails: the client sees an error.
    meter.failNext = true;
    await expect(completeUpload(club.ctx, matchId, started.videoId)).rejects.toThrow(
      "database went away",
    );
    expect((await rawDb.video.findUniqueOrThrow({ where: { id: started.videoId } })).status).toBe(
      "probing",
    );
    const usage = () =>
      rawDb.usageEvent.count({ where: { metric: "storage_bytes", sourceId: started.videoId } });
    expect(await usage()).toBe(0);
    expect(boss.send).not.toHaveBeenCalled();

    // The client's retry finds it complete and recovers both, once.
    expect(await completeUpload(club.ctx, matchId, started.videoId)).toEqual({
      status: "probing",
      alreadyComplete: true,
    });
    expect(await usage()).toBe(1);
    expect(boss.send).toHaveBeenCalledWith(
      "probe",
      { organisationId: club.org.id, videoId: started.videoId },
      { id: started.videoId },
    );
    await completeUpload(club.ctx, matchId, started.videoId);
    expect(await usage()).toBe(1);
  });

  it("pg-boss keeps one probe job for a video id sent twice", async () => {
    const queue = await vi.importActual<typeof import("@/server/queue")>("@/server/queue");
    const real = await queue.getBoss();
    const videoId = randomUUID();
    const job = { organisationId: club.org.id, videoId };
    await real.send(queue.QUEUES.probe, job, { id: videoId });
    await real.send(queue.QUEUES.probe, job, { id: videoId });
    expect(await jobsFor(queue.QUEUES.probe, "videoId", videoId)).toBe(1);
    await real.stop({ graceful: false });
  });
});
