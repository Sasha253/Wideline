import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

// Object storage for the C07 playback spec: puts the HLS fixture
// (`make fixtures`, scripts/make-hls-fixture.ts) where a finished transcode
// leaves it, through Caddy's S3 host. `make test-e2e` passes the keys from
// .env as E2E_S3_ACCESS_KEY_ID, E2E_S3_SECRET_ACCESS_KEY and E2E_S3_BUCKET;
// the spec skips without them.

const accessKeyId = process.env.E2E_S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.E2E_S3_SECRET_ACCESS_KEY;
export const s3Bucket = process.env.E2E_S3_BUCKET;
export const storageConfigured = !!(accessKeyId && secretAccessKey && s3Bucket);

export const HLS_FIXTURE = "tests/fixtures/hls";
const RENDITIONS = ["1080p", "720p", "480p"];

function client(): S3Client {
  return new S3Client({
    endpoint: process.env.E2E_S3_ENDPOINT ?? "http://s3.wideline.localhost",
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

const TYPES: Record<string, string> = {
  m3u8: "application/vnd.apple.mpegurl",
  m4s: "video/iso.segment",
  mp4: "video/mp4",
};

/** Uploads the HLS fixture under `prefix` (ending in "/"). */
export async function putHlsFixture(prefix: string): Promise<void> {
  const s3 = client();
  const put = async (key: string, path: string) =>
    s3.send(
      new PutObjectCommand({
        Bucket: s3Bucket,
        Key: key,
        Body: await readFile(path),
        ContentType: TYPES[path.split(".").pop()!],
      }),
    );
  for (const r of RENDITIONS) {
    for (const file of await readdir(join(HLS_FIXTURE, r))) {
      await put(`${prefix}${r}/${file}`, join(HLS_FIXTURE, r, file));
    }
  }
  await put(`${prefix}master.m3u8`, join(HLS_FIXTURE, "master.m3u8"));
}

/** Deletes everything under `prefix`. */
export async function deletePrefix(prefix: string): Promise<void> {
  const s3 = client();
  const page = await s3.send(new ListObjectsV2Command({ Bucket: s3Bucket, Prefix: prefix }));
  const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
  if (keys.length) {
    await s3.send(new DeleteObjectsCommand({ Bucket: s3Bucket, Delete: { Objects: keys } }));
  }
}
