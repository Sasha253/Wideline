import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { rawDb } from "@/server/db/raw";
import { matchPrefix } from "@/server/matches/keys";
import { createTranscodeJob } from "@/server/processing/jobs";
import { bucket, s3Internal } from "@/server/storage";
import { contentTypeFor, hlsKeys, RENDITION_NAMES } from "@/server/transcode/ladder";
import { FIXTURES_DIR } from "./matches";

// C07 fixtures: an accepted video row (with its raw file in object storage
// when asked), its transcode ProcessingJob, and the generated HLS fixture
// (`make fixtures`, scripts/make-hls-fixture.ts) uploaded as a finished
// transcode would leave it.

export const FOOTAGE_SHORT = join(FIXTURES_DIR, "footage-short-1080p.mp4");
export const HLS_FIXTURE = join(FIXTURES_DIR, "hls");

/** True when ffmpeg is on the PATH and the short clip exists (`make fixtures`). */
export function ffmpegAvailable(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return existsSync(FOOTAGE_SHORT);
  } catch {
    return false;
  }
}

/** True when the HLS fixture exists (`make fixtures`). */
export function hlsFixtureAvailable(): boolean {
  return existsSync(join(HLS_FIXTURE, "master.m3u8"));
}

let n = 0;

/**
 * An accepted video on a Processing match, as the probe leaves it: probe
 * metadata, the match moved to Processing, and the transcode job. With
 * `upload`, the short clip is put at its raw key.
 */
export async function acceptedVideo(
  organisationId: string,
  matchId: string,
  { upload = false, durationSec = 20, height = 1080 } = {},
) {
  n += 1;
  const bytes = upload ? await readFile(FOOTAGE_SHORT) : Buffer.alloc(1024);
  const video = await rawDb.video.create({
    data: {
      organisationId,
      matchId,
      status: "accepted",
      blobPath: "pending",
      fileName: `clip-${n}.mp4`,
      contentType: "video/mp4",
      sizeBytes: BigInt(bytes.length),
      partSize: 8 * 1024 * 1024,
      fingerprint: `fp-${n}-${Date.now()}`,
      uploadedAt: new Date(),
      rawExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      probedAt: new Date(),
      durationSec,
      width: Math.round((height * 16) / 9),
      height,
      fps: 25,
      codec: "h264",
    },
  });
  const blobPath = `${matchPrefix(organisationId, matchId)}raw/${video.id}.mp4`;
  await rawDb.video.update({ where: { id: video.id }, data: { blobPath } });
  if (upload) {
    await s3Internal().send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: blobPath,
        Body: bytes,
        ContentType: "video/mp4",
      }),
    );
  }
  await rawDb.match.update({ where: { id: matchId }, data: { status: "processing" } });
  const { job } = await rawDb.$transaction((tx) =>
    createTranscodeJob(tx, { organisationId, matchId, videoId: video.id }),
  );
  return { video: { ...video, blobPath }, job };
}

/** Uploads the HLS fixture for a video and sets its manifest, as a finished transcode does. */
export async function seedHls(organisationId: string, matchId: string, videoId: string) {
  const keys = hlsKeys(organisationId, matchId, videoId);
  const put = async (key: string, path: string, file: string) =>
    s3Internal().send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: key,
        Body: await readFile(path),
        ContentType: contentTypeFor(file),
      }),
    );
  for (const r of RENDITION_NAMES) {
    for (const file of await readdir(join(HLS_FIXTURE, r))) {
      await put(keys.file(r, file), join(HLS_FIXTURE, r, file), file);
    }
  }
  await put(keys.master, join(HLS_FIXTURE, "master.m3u8"), "master.m3u8");
  await rawDb.video.update({ where: { id: videoId }, data: { hlsManifestPath: keys.master } });
  return keys;
}
