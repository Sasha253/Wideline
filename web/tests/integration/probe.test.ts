import { readFileSync } from "node:fs";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readValidation } from "@/lib/footage-rules";
import { partCount, partRange } from "@/lib/upload/part-plan";
import type { AuthContext } from "@/server/auth/session";
import { rawDb } from "@/server/db/raw";
import { getMatch } from "@/server/matches/matches";
import { completeUpload, presignParts, startUpload } from "@/server/matches/upload";
import { bucket, s3Internal } from "@/server/storage";
import { handleProbe } from "@/worker/probe";
import { deletePrefix } from "@/worker/retention";
import { fixtures } from "./helpers/fixtures";
import {
  FOOTAGE_1080P,
  FOOTAGE_720P,
  ffprobeAvailable,
  match,
  setupClub,
  storageAvailable,
} from "./helpers/matches";

// C06 acceptance (MATCH03, MATCH04): footage under 1080p is rejected with
// guidance. The worker's probe handler with real ffprobe on generated footage
// (`make fixtures`), uploaded to RustFS through the real upload service.
// C07: accepted footage gets one transcode ProcessingJob and one pg-boss send
// with its bossJobId; a retried probe sends the same id again. C08: and one cv
// job, sent the same way, so the two run in parallel.
// Skipped without object storage, ffprobe or the fixtures (CI; see STATUS.md).

const boss = vi.hoisted(() => ({
  send: vi.fn<(queue: string, data: unknown, options?: object) => Promise<string | null>>(
    async () => "job-id",
  ),
}));
vi.mock("@/server/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/queue")>()),
  getBoss: async () => boss,
}));

const hasFfprobe = ffprobeAvailable();
const hasStorage = await storageAvailable();
const ready = hasFfprobe && hasStorage;
if (!ready) {
  console.warn(
    `probe: skipped, ${hasFfprobe ? "" : "no ffprobe or footage fixtures (make fixtures)"}${!hasFfprobe && !hasStorage ? " and " : ""}${hasStorage ? "" : "no object storage answers (RustFS)"}`,
  );
}
const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;

beforeAll(async () => {
  if (!ready) return;
  club = await setupClub(f, "Probe FC");
});

afterAll(async () => {
  if (ready && club) await deletePrefix(`orgs/${club.org.id}/`);
  await f.cleanup();
});

/** Uploads a local file for a match through presigned parts and completes it. */
async function upload(ctx: AuthContext, matchId: string, path: string, name: string) {
  const bytes = readFileSync(path);
  const info = await startUpload(ctx, matchId, {
    fileName: name,
    size: bytes.length,
    type: "video/mp4",
    lastModified: 1,
  });
  const count = partCount(bytes.length, info.partSize);
  const numbers = Array.from({ length: count }, (_, i) => i + 1);
  const urls = await presignParts(ctx, matchId, { videoId: info.videoId, partNumbers: numbers });
  for (const n of numbers) {
    const { start, end } = partRange(n, bytes.length, info.partSize);
    const res = await fetch(urls[n]!, { method: "PUT", body: bytes.subarray(start, end) });
    expect(res.status).toBe(200);
  }
  await completeUpload(ctx, matchId, info.videoId);
  return info.videoId;
}

describe.skipIf(!ready)("probe", { timeout: 60_000 }, () => {
  it("rejects 720p footage with guidance, sends the match back to Draft and keeps the file", async () => {
    const { id: matchId } = await match(club.coachCtx, club.own.id, club.opposition.id);
    const videoId = await upload(club.coachCtx, matchId, FOOTAGE_720P, "phone-export.mp4");

    expect(await handleProbe({ organisationId: club.org.id, videoId })).toBe("rejected");

    const video = await rawDb.video.findUniqueOrThrow({ where: { id: videoId } });
    expect(video).toMatchObject({ status: "rejected", width: 1280, height: 720, deletedAt: null });
    const validation = readValidation(video.validation);
    expect(validation?.verdict).toBe("rejected");
    expect(validation?.issues.find((i) => i.code === "low_resolution")).toEqual({
      code: "low_resolution",
      severity: "reject",
      message: "This video is 1280 × 720. Wideline needs at least 1080p (1920 × 1080).",
      guidance:
        "Set the camera to 1080p or higher before the next match, and export at the original quality. Phone apps often shrink exports to 720p.",
    });
    expect((await getMatch(club.ctx, matchId)).status).toBe("draft");
    // NFR32: only the retention job deletes it, at rawExpiresAt.
    const head = await s3Internal().send(
      new HeadObjectCommand({ Bucket: bucket(), Key: video.blobPath }),
    );
    expect(head.ContentLength).toBeGreaterThan(0);
    expect(
      await rawDb.usageEvent.count({ where: { metric: "video_seconds", sourceId: videoId } }),
    ).toBe(0);
    // C07: rejected footage is not transcoded.
    expect(await rawDb.processingJob.count({ where: { videoId } })).toBe(0);
  });

  it("accepts 1080p footage, saves its metadata and moves the match to Processing", async () => {
    const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
    const videoId = await upload(club.ctx, matchId, FOOTAGE_1080P, "veo-export.mp4");

    expect(await handleProbe({ organisationId: club.org.id, videoId })).toBe("accepted");

    const video = await rawDb.video.findUniqueOrThrow({ where: { id: videoId } });
    expect(video).toMatchObject({
      status: "accepted",
      width: 1920,
      height: 1080,
      fps: 25,
      codec: "h264",
      rotation: 0,
    });
    expect(video.durationSec).toBeCloseTo(330, 0);
    expect(video.probedAt).not.toBeNull();
    expect(video.rawExpiresAt!.getTime() - video.uploadedAt!.getTime()).toBe(7 * 24 * 3600 * 1000);
    // A 5.5 min clip of a 2 x 45 match warns about its length but is accepted.
    expect(readValidation(video.validation)?.verdict).toBe("accepted_with_warnings");
    expect((await getMatch(club.ctx, matchId)).status).toBe("processing");

    const usage = await rawDb.usageEvent.findMany({
      where: { metric: "video_seconds", sourceId: videoId },
    });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ quantity: BigInt(330), sourceType: "Video" });

    // C07 and C08: one transcode and one cv job, each sent once with its own
    // id as the pg-boss id.
    const jobs = await rawDb.processingJob.findMany({
      where: { videoId },
      orderBy: { type: "asc" },
    });
    expect(jobs.map((j) => j.type)).toEqual(["transcode", "cv"]);
    for (const j of jobs) {
      expect(j).toMatchObject({
        status: "queued",
        attempts: 0,
        matchId,
        organisationId: club.org.id,
      });
    }
    const [transcode, cv] = jobs as [(typeof jobs)[0], (typeof jobs)[0]];
    const sends = () => boss.send.mock.calls.filter(([q]) => q === "transcode");
    expect(sends()).toEqual([
      [
        "transcode",
        { organisationId: club.org.id, videoId, processingJobId: transcode.id },
        { id: transcode.bossJobId, expireInSeconds: 5 * 3600 },
      ],
    ]);
    const cvSends = () => boss.send.mock.calls.filter(([q]) => q === "cv");
    expect(cvSends()).toEqual([
      [
        "cv",
        { organisationId: club.org.id, videoId, processingJobId: cv.id },
        { id: cv.bossJobId, expireInSeconds: 4 * 3600 + 1800 },
      ],
    ]);

    // A retried job finds the video already probed and changes nothing, but
    // sends the transcode job again with the same id (a no-op in pg-boss), in
    // case the first send failed.
    expect(await handleProbe({ organisationId: club.org.id, videoId })).toBe("skipped");
    expect(
      await rawDb.usageEvent.count({ where: { metric: "video_seconds", sourceId: videoId } }),
    ).toBe(1);
    expect(await rawDb.processingJob.count({ where: { videoId } })).toBe(2);
    expect(sends()).toHaveLength(2);
    expect(sends()[1]![2]).toEqual({ id: transcode.bossJobId, expireInSeconds: 5 * 3600 });
    expect(cvSends()).toHaveLength(2);
    expect(cvSends()[1]![2]).toEqual({ id: cv.bossJobId, expireInSeconds: 4 * 3600 + 1800 });
  });

  it("only handles a video of the job's organisation", async () => {
    const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
    const videoId = await upload(club.ctx, matchId, FOOTAGE_720P, "again.mp4");
    expect(await handleProbe({ organisationId: "another-org", videoId })).toBe("skipped");
    expect((await rawDb.video.findUniqueOrThrow({ where: { id: videoId } })).status).toBe(
      "probing",
    );
  });

  it("rejects a file ffprobe cannot read, and retries a transient failure", async () => {
    const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
    const videoId = await upload(club.ctx, matchId, FOOTAGE_720P, "broken.mp4");
    await expect(
      handleProbe({ organisationId: club.org.id, videoId }, async () => {
        throw new Error("ffprobe failed: Connection refused");
      }),
    ).rejects.toThrow(/Connection refused/);
    expect((await rawDb.video.findUniqueOrThrow({ where: { id: videoId } })).status).toBe(
      "probing",
    );
    expect(await handleProbe({ organisationId: club.org.id, videoId }, async () => null)).toBe(
      "rejected",
    );
    const video = await rawDb.video.findUniqueOrThrow({ where: { id: videoId } });
    expect(readValidation(video.validation)?.issues.map((i) => i.code)).toEqual(["unreadable"]);
  });
});
