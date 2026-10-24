import "server-only";
import { createHash, randomUUID } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  ListPartsCommand,
  UploadPartCommand,
  type Part,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { VideoStatus } from "@/generated/prisma/enums";
import { formatGB, formatSize } from "@/lib/labels";
import {
  ACCEPTED_TYPES,
  fingerprintSource,
  partCount,
  partRange,
  partSizeFor,
  videoKind,
} from "@/lib/upload/part-plan";
import type { AuthContext } from "../auth/session";
import { audit } from "../audit";
import { hasCapacity, limitFor } from "../entitlements";
import { log } from "../log";
import { getBoss, QUEUES, type ProbeJob } from "../queue";
import { asTransactionClient } from "../squad/tx";
import { bucket, s3Internal, s3Public } from "../storage";
import { recordUsage } from "../usage/meter";
import { requireSquadOrg } from "./access";
import { MatchError } from "./errors";
import { presignSchema, uploadStartSchema, type UploadStartInput } from "./fields";
import { fromStatusesFor } from "./status";

/**
 * Resumable upload straight to object storage (MATCH02, NFR26;
 * docs/build/design/C06.md, Surface 3). The browser sends parts to presigned
 * UploadPart URLs (src/lib/upload/multipart-client.ts); the server only opens,
 * lists, completes and aborts the S3 multipart upload. ListParts on the server
 * is the truth about what arrived, never ETags the client reports, so a
 * reload, another tab or another device resumes from the same state.
 *
 * Control calls use the internal S3 endpoint; part URLs are signed for the
 * public host the browser reaches. The upload cap is read through
 * hasCapacity() (BILL01). Completing records storage_bytes and enqueues the
 * worker's ffprobe check, both exactly once.
 */

/** Part URLs last an hour; the uploader fetches fresh ones on a 403. */
export const PART_URL_TTL_SEC = 60 * 60;

/** Raw footage is kept for 7 days after upload (MATCH07, NFR32), then C17 deletes it. */
export const RAW_RETENTION_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export type UploadInfo = {
  videoId: string;
  status: VideoStatus;
  fileName: string;
  sizeBytes: number;
  partSize: number;
  partCount: number;
  fingerprint: string;
  /** Parts the store holds, from ListParts (uploading only). */
  uploadedParts: { partNumber: number; size: number }[];
  uploadedBytes: number;
};

export function fingerprintOf(file: { name: string; size: number; lastModified: number }): string {
  return createHash("sha256").update(fingerprintSource(file)).digest("hex");
}

/** orgs/{organisationId}/matches/{matchId}/: everything stored for a match. */
export function matchPrefix(organisationId: string, matchId: string): string {
  return `orgs/${organisationId}/matches/${matchId}/`;
}

function rawKey(organisationId: string, matchId: string, videoId: string, ext: string): string {
  return `${matchPrefix(organisationId, matchId)}raw/${videoId}.${ext}`;
}

type VideoRow = {
  id: string;
  status: VideoStatus;
  fileName: string;
  sizeBytes: bigint;
  partSize: number;
  fingerprint: string;
  blobPath: string;
  s3UploadId: string | null;
};

const VIDEO_SELECT = {
  id: true,
  status: true,
  fileName: true,
  sizeBytes: true,
  partSize: true,
  fingerprint: true,
  blobPath: true,
  s3UploadId: true,
} as const;

/** Every part S3 holds for an open upload, following ListParts pagination. */
export async function listUploadedParts(key: string, uploadId: string): Promise<Part[]> {
  const parts: Part[] = [];
  let marker: string | undefined;
  for (;;) {
    const page = await s3Internal().send(
      new ListPartsCommand({
        Bucket: bucket(),
        Key: key,
        UploadId: uploadId,
        PartNumberMarker: marker,
        MaxParts: 1000,
      }),
    );
    parts.push(...(page.Parts ?? []));
    if (!page.IsTruncated || !page.NextPartNumberMarker) break;
    marker = page.NextPartNumberMarker;
  }
  return parts;
}

/** The parts that arrived whole: right number, right size. Others are sent again. */
function goodParts(v: VideoRow, parts: Part[]) {
  const size = Number(v.sizeBytes);
  return parts.filter((p) => {
    const n = p.PartNumber ?? 0;
    if (n < 1 || n > partCount(size, v.partSize)) return false;
    const { start, end } = partRange(n, size, v.partSize);
    return p.Size === end - start;
  });
}

async function info(v: VideoRow): Promise<UploadInfo> {
  const size = Number(v.sizeBytes);
  const base = {
    videoId: v.id,
    status: v.status,
    fileName: v.fileName,
    sizeBytes: size,
    partSize: v.partSize,
    partCount: partCount(size, v.partSize),
    fingerprint: v.fingerprint,
  };
  if (v.status !== "uploading" || !v.s3UploadId) {
    return { ...base, uploadedParts: [], uploadedBytes: v.status === "uploading" ? 0 : size };
  }
  const parts = goodParts(v, await listUploadedParts(v.blobPath, v.s3UploadId));
  const uploadedParts = parts
    .map((p) => ({ partNumber: p.PartNumber!, size: p.Size! }))
    .sort((a, b) => a.partNumber - b.partNumber);
  return {
    ...base,
    uploadedParts,
    uploadedBytes: uploadedParts.reduce((sum, p) => sum + p.size, 0),
  };
}

function isNoSuchUpload(err: unknown): boolean {
  const name = (err as { name?: string; Code?: string } | null)?.name;
  return name === "NoSuchUpload" || (err as { Code?: string } | null)?.Code === "NoSuchUpload";
}

async function abortQuietly(key: string, uploadId: string): Promise<void> {
  try {
    await s3Internal().send(
      new AbortMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: uploadId }),
    );
  } catch (err) {
    if (!isNoSuchUpload(err)) throw err;
  }
}

/** "This file is 9.2 GB. The most you can upload for one match is 8.59 GB." */
export function tooBigMessage(size: number, limit: number): string {
  return `This file is ${formatSize(size)}. The most you can upload for one match is ${formatGB(limit)}.`;
}

export const WRONG_TYPE = "Choose an MP4 or MOV file.";
export const EMPTY_FILE = "This file is empty. Choose the match video.";
export const FOOTAGE_EXISTS =
  "This match has accepted footage. To use a different recording, an owner or admin deletes the match and you create it again.";

/**
 * Opens an upload for a match, or resumes the open one for the same file
 * (same fingerprint). Another open upload for the match is aborted: the club
 * chose a different file. Refused once footage is being checked or accepted.
 * The match moves Draft to Uploading.
 */
export async function startUpload(
  ctx: AuthContext,
  matchId: string,
  input: UploadStartInput,
): Promise<UploadInfo> {
  requireSquadOrg(ctx);
  const file = uploadStartSchema.parse(input);
  const kind = videoKind(file.fileName, file.type);
  if (!kind) throw new MatchError("upload_type", WRONG_TYPE);
  if (file.size === 0) throw new MatchError("upload_empty", EMPTY_FILE);
  if (!(await hasCapacity(ctx.organisationId, "upload_max_bytes", 0, file.size))) {
    const limit = await limitFor(ctx.organisationId, "upload_max_bytes");
    throw new MatchError("upload_too_big", tooBigMessage(file.size, limit));
  }
  const fingerprint = fingerprintOf({
    name: file.fileName,
    size: file.size,
    lastModified: file.lastModified,
  });

  const match = await ctx.db.match.findFirst({
    where: { id: matchId },
    select: {
      status: true,
      videos: {
        where: { status: { in: ["uploading", "probing", "accepted"] } },
        select: VIDEO_SELECT,
      },
    },
  });
  if (!match) throw new MatchError("not_found");
  if (
    !["draft", "uploading"].includes(match.status) ||
    match.videos.some((v) => v.status !== "uploading")
  ) {
    throw new MatchError("upload_exists", FOOTAGE_EXISTS);
  }
  const same = match.videos.find((v) => v.fingerprint === fingerprint);
  if (same) return info(same);
  for (const other of match.videos) await cancelVideo(ctx, matchId, other, { moveMatch: false });

  const videoId = randomUUID();
  const key = rawKey(ctx.organisationId, matchId, videoId, kind);
  const contentType = ACCEPTED_TYPES[kind].mime;
  const partSize = partSizeFor(file.size);
  const created = await s3Internal().send(
    new CreateMultipartUploadCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
  );
  if (!created.UploadId) throw new Error("CreateMultipartUpload returned no UploadId");
  try {
    const video = await ctx.db.$transaction(async (tx) => {
      const v = await tx.video.create({
        data: {
          id: videoId,
          organisationId: ctx.organisationId,
          matchId,
          status: "uploading",
          blobPath: key,
          fileName: file.fileName,
          contentType,
          sizeBytes: BigInt(file.size),
          partSize,
          s3UploadId: created.UploadId,
          fingerprint,
          uploadedByUserId: ctx.user.id,
        },
        select: VIDEO_SELECT,
      });
      await tx.match.updateMany({
        where: { id: matchId, status: { in: fromStatusesFor("uploading") } },
        data: { status: "uploading" },
      });
      await audit(
        {
          organisationId: ctx.organisationId,
          actorUserId: ctx.user.id,
          action: "video.upload_started",
          targetType: "Video",
          targetId: videoId,
          metadata: { matchId, sizeBytes: file.size },
        },
        asTransactionClient(tx),
      );
      return v;
    });
    return info(video);
  } catch (err) {
    await abortQuietly(key, created.UploadId);
    // A concurrent start for the same match won the one-live-video index.
    if ((err as { code?: string }).code === "P2002") {
      throw new MatchError("upload_exists", FOOTAGE_EXISTS);
    }
    throw err;
  }
}

/** The match's live video and how much of it arrived, or null with none. */
export async function uploadStatus(ctx: AuthContext, matchId: string): Promise<UploadInfo | null> {
  requireSquadOrg(ctx);
  const match = await ctx.db.match.findFirst({
    where: { id: matchId },
    select: {
      videos: {
        where: { status: { in: ["uploading", "probing", "accepted"] } },
        select: VIDEO_SELECT,
      },
    },
  });
  if (!match) throw new MatchError("not_found");
  const video = match.videos[0];
  return video ? info(video) : null;
}

async function openUpload(ctx: AuthContext, matchId: string, videoId: string): Promise<VideoRow> {
  const video = await ctx.db.video.findFirst({
    where: { id: videoId, matchId },
    select: VIDEO_SELECT,
  });
  if (!video || video.status !== "uploading" || !video.s3UploadId) {
    throw new MatchError("upload_gone");
  }
  return video;
}

/** Presigned UploadPart URLs (1 h) for up to 50 parts of an open upload. */
export async function presignParts(
  ctx: AuthContext,
  matchId: string,
  input: { videoId: string; partNumbers: number[] },
): Promise<Record<number, string>> {
  requireSquadOrg(ctx);
  const { videoId, partNumbers } = presignSchema.parse(input);
  const video = await openUpload(ctx, matchId, videoId);
  const count = partCount(Number(video.sizeBytes), video.partSize);
  if (partNumbers.some((n) => n > count)) throw new MatchError("invalid");
  const urls: Record<number, string> = {};
  for (const n of new Set(partNumbers)) {
    urls[n] = await getSignedUrl(
      s3Public(),
      new UploadPartCommand({
        Bucket: bucket(),
        Key: video.blobPath,
        UploadId: video.s3UploadId!,
        PartNumber: n,
      }),
      { expiresIn: PART_URL_TTL_SEC },
    );
  }
  return urls;
}

export type CompleteResult = { status: VideoStatus; alreadyComplete: boolean };

/**
 * Completes an upload. Idempotent: a second call for a completed video
 * returns its status and changes nothing. ListParts must hold every part at
 * its size, else MatchError("missing_parts") with the part numbers to send
 * again. After commit, records storage_bytes once and enqueues the probe once.
 */
export async function completeUpload(
  ctx: AuthContext,
  matchId: string,
  videoId: string,
  now = new Date(),
): Promise<CompleteResult> {
  requireSquadOrg(ctx);
  const video = await ctx.db.video.findFirst({
    where: { id: videoId, matchId },
    select: VIDEO_SELECT,
  });
  if (!video || video.status === "cancelled") throw new MatchError("upload_gone");
  if (video.status !== "uploading" || !video.s3UploadId) {
    return { status: video.status, alreadyComplete: true };
  }
  const size = Number(video.sizeBytes);
  const count = partCount(size, video.partSize);
  let completed = false;
  try {
    const parts = goodParts(video, await listUploadedParts(video.blobPath, video.s3UploadId));
    const have = new Set(parts.map((p) => p.PartNumber!));
    const missing = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !have.has(n));
    if (missing.length) {
      throw new MatchError("missing_parts", undefined, undefined, undefined, { missing });
    }
    await s3Internal().send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket(),
        Key: video.blobPath,
        UploadId: video.s3UploadId,
        MultipartUpload: {
          Parts: parts
            .sort((a, b) => a.PartNumber! - b.PartNumber!)
            .map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })),
        },
      }),
    );
    completed = true;
  } catch (err) {
    // A concurrent complete finished the upload first: the object exists.
    if (!isNoSuchUpload(err)) throw err;
  }
  const head = await s3Internal().send(
    new HeadObjectCommand({ Bucket: bucket(), Key: video.blobPath }),
  );
  if (head.ContentLength !== size) {
    log.error(
      { organisationId: ctx.organisationId, videoId, expected: size, actual: head.ContentLength },
      "completed upload has the wrong size",
    );
    throw new Error("Completed upload has the wrong size");
  }

  const uploadedAt = now;
  const moved = await ctx.db.$transaction(async (tx) => {
    const { count: n } = await tx.video.updateMany({
      where: { id: videoId, status: "uploading" },
      data: {
        status: "probing",
        s3UploadId: null,
        uploadedAt,
        rawExpiresAt: new Date(uploadedAt.getTime() + RAW_RETENTION_DAYS * DAY_MS),
      },
    });
    if (n === 1) {
      await audit(
        {
          organisationId: ctx.organisationId,
          actorUserId: ctx.user.id,
          action: "video.uploaded",
          targetType: "Video",
          targetId: videoId,
          metadata: { matchId, sizeBytes: size, parts: count },
        },
        asTransactionClient(tx),
      );
    }
    return n === 1;
  });
  if (!moved) {
    const now2 = await ctx.db.video.findFirst({ where: { id: videoId }, select: { status: true } });
    return { status: now2?.status ?? "probing", alreadyComplete: true };
  }
  log.info({ organisationId: ctx.organisationId, videoId, matchId, completed }, "upload complete");
  await recordUsage({
    organisationId: ctx.organisationId,
    metric: "storage_bytes",
    quantity: size,
    sourceType: "Video",
    sourceId: videoId,
    metadata: { matchId },
  });
  await enqueueProbe({ organisationId: ctx.organisationId, videoId });
  return { status: "probing", alreadyComplete: false };
}

/**
 * Enqueues the ffprobe check. A failure is logged and leaves the video in
 * probing; C18's admin console re-runs stuck and dead-lettered probes.
 */
async function enqueueProbe(job: ProbeJob): Promise<void> {
  try {
    const boss = await getBoss();
    await boss.send(QUEUES.probe, job);
  } catch (err) {
    log.error({ err, ...job }, "probe enqueue failed");
  }
}

async function cancelVideo(
  ctx: AuthContext,
  matchId: string,
  video: VideoRow,
  { moveMatch }: { moveMatch: boolean },
): Promise<void> {
  if (video.s3UploadId) await abortQuietly(video.blobPath, video.s3UploadId);
  await ctx.db.$transaction(async (tx) => {
    const { count } = await tx.video.updateMany({
      where: { id: video.id, status: "uploading" },
      data: { status: "cancelled", s3UploadId: null },
    });
    if (count === 0) return;
    if (moveMatch) {
      await tx.match.updateMany({
        where: { id: matchId, status: "uploading" },
        data: { status: "draft" },
      });
    }
    await audit(
      {
        organisationId: ctx.organisationId,
        actorUserId: ctx.user.id,
        action: "video.upload_cancelled",
        targetType: "Video",
        targetId: video.id,
        metadata: { matchId },
      },
      asTransactionClient(tx),
    );
  });
}

/** Aborts an open upload: the parts are thrown away and the match goes back to Draft. */
export async function cancelUpload(
  ctx: AuthContext,
  matchId: string,
  videoId: string,
): Promise<void> {
  requireSquadOrg(ctx);
  const video = await openUpload(ctx, matchId, videoId);
  await cancelVideo(ctx, matchId, video, { moveMatch: true });
}
