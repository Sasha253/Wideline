import { cp, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// C07 (NFR31): a job's whole history can be rebuilt from the structured logs.
// Captures the pino output of a fail-then-succeed run (queued, enqueued,
// started 1, attempt_failed 1, started 2, succeeded) and rebuilds it by
// processingJobId: every line carries ids, the attempt and timings, and no
// names. The encoder is a stand-in that writes the HLS fixture, so the run
// needs object storage but not ffmpeg.

const lines = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/server/log", async () => {
  const pino = (await import("pino")).default;
  const actual = await vi.importActual<typeof import("@/server/log")>("@/server/log");
  const sink = new Writable({
    write(chunk, _enc, done) {
      for (const l of String(chunk).split("\n").filter(Boolean)) lines.push(JSON.parse(l));
      done();
    },
  });
  return { ...actual, log: pino(actual.logOptions, sink) };
});

const boss = vi.hoisted(() => ({ send: vi.fn(async () => "job-id") }));
vi.mock("@/server/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/queue")>()),
  getBoss: async () => boss,
}));

const { jobLog } = await import("@/server/processing/jobs");
const { onFootageAccepted } = await import("@/worker/probe");
const { deletePrefix } = await import("@/worker/retention");
const { handleTranscode } = await import("@/worker/transcode");
const { fixtures } = await import("./helpers/fixtures");
const { match, setupClub, storageAvailable } = await import("./helpers/matches");
const { acceptedVideo, HLS_FIXTURE, hlsFixtureAvailable } = await import("./helpers/transcode");

const ready = (await storageAvailable()) && hlsFixtureAvailable();
if (!ready) console.warn("transcode-log: SKIPPED, no object storage (RustFS) or HLS fixture");
const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;

beforeAll(async () => {
  if (!ready) return;
  club = await setupClub(f, "Log FC");
});

afterAll(async () => {
  if (ready && club) await deletePrefix(`orgs/${club.org.id}/`);
  await f.cleanup();
});

describe.skipIf(!ready)("transcode job history", { timeout: 60_000 }, () => {
  it("rebuilds queued, enqueued, a failed attempt and a successful retry from the log", async () => {
    const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
    const { video, job } = await acceptedVideo(club.org.id, matchId);
    // As handleProbe does after its transaction commits.
    jobLog("queued", job);
    await onFootageAccepted({ organisationId: club.org.id, videoId: video.id, matchId });

    let calls = 0;
    const runner = {
      hasAudio: async () => true,
      encode: async ({
        outDir,
        onProgress,
      }: {
        outDir: string;
        onProgress: (ms: number) => void;
      }) => {
        calls += 1;
        if (calls === 1) throw new Error("ffmpeg failed (exit code 1): Connection reset by peer");
        onProgress(10_000);
        await cp(HLS_FIXTURE, outDir, { recursive: true });
        // As ffmpeg names it with several renditions; the worker renames it.
        const dir = join(outDir, "720p");
        await rename(join(dir, "init.mp4"), join(dir, "init_1.mp4"));
        const playlist = join(dir, "index.m3u8");
        await writeFile(
          playlist,
          (await readFile(playlist, "utf8")).replace('URI="init.mp4"', 'URI="init_1.mp4"'),
        );
      },
    };
    const data = { organisationId: club.org.id, videoId: video.id, processingJobId: job.id };
    await expect(
      handleTranscode(data, { retryCount: 0, retryLimit: 2 }, { runner }),
    ).rejects.toThrow(/Connection reset/);
    expect(await handleTranscode(data, { retryCount: 1, retryLimit: 2 }, { runner })).toBe(
      "succeeded",
    );

    const history = lines.filter((l) => l.msg === "processing job" && l.processingJobId === job.id);
    expect(history.map((l) => [l.event, l.attempt])).toEqual([
      ["queued", 0],
      ["enqueued", 0],
      ["started", 1],
      ["attempt_failed", 1],
      ["started", 2],
      ["progress", 2],
      ["succeeded", 2],
    ]);
    for (const l of history) {
      expect(l).toMatchObject({
        processingJobId: job.id,
        bossJobId: job.bossJobId,
        type: "transcode",
        organisationId: club.org.id,
        matchId,
        videoId: video.id,
        maxAttempts: 3,
      });
      expect(typeof l.queuedAt).toBe("string");
      expect(Object.keys(l)).not.toEqual(expect.arrayContaining(["name"]));
      expect(JSON.stringify(l)).not.toContain(video.fileName);
      expect(JSON.stringify(l)).not.toContain("Log FC");
    }
    const [, , started1, failed1, started2, progress, succeeded] = history;
    expect(started1!.startedAt).toEqual(expect.any(String));
    expect(failed1).toMatchObject({
      level: 40,
      error: "ffmpeg failed (exit code 1): Connection reset by peer",
    });
    expect(started2!.startedAt).toBe(started1!.startedAt);
    expect(progress).toMatchObject({ percent: 50 });
    expect(succeeded).toMatchObject({ finishedAt: expect.any(String) });
    expect(succeeded!.encodeMs).toEqual(expect.any(Number));
    expect(succeeded!.uploadMs).toEqual(expect.any(Number));
  });
});
