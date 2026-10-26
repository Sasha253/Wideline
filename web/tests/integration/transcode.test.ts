import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db/raw";
import { bucket, s3Internal } from "@/server/storage";
import { hlsKeys } from "@/server/transcode/ladder";
import { storageBytesForMatch } from "@/server/usage/meter";
import { deletePrefix, handleRetention } from "@/worker/retention";
import { handleTranscode } from "@/worker/transcode";
import { fixtures } from "./helpers/fixtures";
import { match, setupClub, storageAvailable } from "./helpers/matches";
import { acceptedVideo, ffmpegAvailable } from "./helpers/transcode";

// C07 (MATCH06, NFR06, ADMIN05): the transcode job with real ffmpeg and
// RustFS on the 20 s 1080p fixture. Three renditions land under the match
// prefix, the video gets its manifest, the job records its timings, each
// rendition is metered once with its matchId, a re-run records nothing, and
// the match_deleted purge removes the HLS and nets storage to 0. Skipped
// without object storage, ffmpeg or the fixture (CI; see STATUS.md).

const hasFfmpeg = ffmpegAvailable();
const hasStorage = await storageAvailable();
const ready = hasFfmpeg && hasStorage;
if (!ready) {
  console.warn(
    `transcode: SKIPPED, ${hasFfmpeg ? "" : "no ffmpeg or footage-short-1080p.mp4 (make fixtures) "}${hasStorage ? "" : "no object storage answers (RustFS)"}`,
  );
}
const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;

beforeAll(async () => {
  if (!ready) return;
  club = await setupClub(f, "Transcode FC");
});

afterAll(async () => {
  if (ready && club) await deletePrefix(`orgs/${club.org.id}/`);
  await f.cleanup();
});

const list = async (prefix: string) =>
  (
    (await s3Internal().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix })))
      .Contents ?? []
  ).map((o) => o.Key!.slice(prefix.length));

describe.skipIf(!ready)("transcode", { timeout: 120_000 }, () => {
  it("makes the HLS ladder, meters each rendition once and is purged with the match", async () => {
    const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
    const { video, job } = await acceptedVideo(club.org.id, matchId, { upload: true });
    const data = { organisationId: club.org.id, videoId: video.id, processingJobId: job.id };

    expect(await handleTranscode(data, { retryCount: 0, retryLimit: 2 })).toBe("succeeded");

    const keys = hlsKeys(club.org.id, matchId, video.id);
    expect(keys.prefix).toBe(`orgs/${club.org.id}/matches/${matchId}/hls/${video.id}/`);
    const files = await list(keys.prefix);
    expect(files).toContain("master.m3u8");
    for (const r of ["1080p", "720p", "480p"]) {
      expect(files).toContain(`${r}/index.m3u8`);
      expect(files).toContain(`${r}/init.mp4`);
      expect(files.filter((x) => x.startsWith(`${r}/seg_`)).length).toBeGreaterThanOrEqual(5);
    }
    expect(
      files.every((x) =>
        /^(master\.m3u8|(1080p|720p|480p)\/(index\.m3u8|init\.mp4|seg_\d{5}\.m4s))$/.test(x),
      ),
    ).toBe(true);

    const after = await rawDb.video.findUniqueOrThrow({ where: { id: video.id } });
    expect(after.hlsManifestPath).toBe(keys.master);

    const row = await rawDb.processingJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ status: "succeeded", attempts: 1, errorMessage: null });
    expect(row.startedAt).not.toBeNull();
    expect(row.finishedAt!.getTime()).toBeGreaterThanOrEqual(row.startedAt!.getTime());
    const meta = row.metadata as {
      renditions: { name: string; bytes: number; segments: number }[];
      encodeMs: number;
      uploadMs: number;
      realtimeFactor: number;
      hasAudio: boolean;
    };
    expect(meta.renditions.map((r) => r.name)).toEqual(["1080p", "720p", "480p"]);
    expect(meta.encodeMs).toBeGreaterThan(0);
    expect(meta.uploadMs).toBeGreaterThanOrEqual(0);
    expect(meta.realtimeFactor).toBeCloseTo(meta.encodeMs / 20_000, 3);
    expect(meta.hasAudio).toBe(true);

    const usage = await rawDb.usageEvent.findMany({
      where: { organisationId: club.org.id, metric: "storage_bytes", sourceType: "Rendition" },
      orderBy: { sourceId: "asc" },
    });
    expect(usage.map((u) => u.sourceId).sort()).toEqual(
      ["1080p", "480p", "720p"].map((r) => `${video.id}:${r}`),
    );
    for (const u of usage) {
      expect(u.metadata).toMatchObject({ matchId, videoId: video.id });
      expect(u.quantity).toBeGreaterThan(BigInt(0));
    }
    const hlsBytes = usage.reduce((s, u) => s + u.quantity, BigInt(0));
    expect(hlsBytes).toBe(BigInt(meta.renditions.reduce((s, r) => s + r.bytes, 0)));
    expect(await storageBytesForMatch(club.org.id, matchId)).toBe(hlsBytes);

    // NFR06: a replayed job finds it done and records nothing more.
    expect(await handleTranscode(data, { retryCount: 1, retryLimit: 2 })).toBe("skipped");
    expect(
      await rawDb.usageEvent.count({
        where: { organisationId: club.org.id, sourceType: "Rendition" },
      }),
    ).toBe(3);

    // MATCH08: the match_deleted purge removes the HLS and nets storage to 0.
    await handleRetention({
      kind: "match_deleted",
      organisationId: club.org.id,
      matchId,
      uploads: [],
      rawExpiresAt: null,
    });
    expect(await list(`orgs/${club.org.id}/matches/${matchId}/`)).toEqual([]);
    expect(await storageBytesForMatch(club.org.id, matchId)).toBe(BigInt(0));
  });

  it("skips a video no longer accepted, and a job of another organisation", async () => {
    const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
    const { video, job } = await acceptedVideo(club.org.id, matchId);
    const ran: string[] = [];
    const runner = {
      hasAudio: async () => {
        ran.push("probe");
        return false;
      },
      encode: async () => {
        ran.push("encode");
      },
    };
    expect(
      await handleTranscode(
        { organisationId: "another-org", videoId: video.id, processingJobId: job.id },
        { retryCount: 0, retryLimit: 2 },
        { runner },
      ),
    ).toBe("skipped");
    await rawDb.video.update({ where: { id: video.id }, data: { deletedAt: new Date() } });
    expect(
      await handleTranscode(
        { organisationId: club.org.id, videoId: video.id, processingJobId: job.id },
        { retryCount: 0, retryLimit: 2 },
        { runner },
      ),
    ).toBe("skipped");
    expect(ran).toEqual([]);
    expect((await rawDb.processingJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      "queued",
    );
  });
});
