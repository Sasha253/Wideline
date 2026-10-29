import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ingestCvResult } from "@/server/cv/ingest";
import { rawDb } from "@/server/db/raw";
import { handleClips } from "@/worker/clips";
import { fakeCutter, ingestInput } from "./helpers/clips";
import { event, platformAdmin, result, runningCvJob } from "./helpers/cv";
import { fixtures } from "./helpers/fixtures";
import { match, setupClub } from "./helpers/matches";
import { acceptedVideo } from "./helpers/transcode";

// C09 (CV11, NFR06, NFR30): the clips job with a fake cutter. A crash halfway
// leaves the cut clips committed; the retry cuts only the missing ones and
// records usage once per clip. A video no longer accepted settles the job
// without cutting. The third failure fails the match and alerts platform
// admins once. Zero events succeed at once.

const deliverMail = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/server/mail-transport", () => ({ deliverMail }));

const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;

beforeAll(async () => {
  club = await setupClub(f, "Clips FC");
  await platformAdmin(f);
});

afterAll(async () => {
  await f.cleanup();
});

/** A match with an ingested cv result of `n` events, and its clips job. */
async function setup(n: number) {
  const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
  const { video } = await acceptedVideo(club.org.id, matchId, { durationSec: 300 });
  const job = await runningCvJob(club.org.id, matchId, video.id);
  const events = Array.from({ length: n }, (_, i) =>
    event("touch", null, 0.9, 20_000 + i * 20_000),
  );
  const out = await ingestCvResult(ingestInput(job, video.id, result(job, [], events)));
  const data = {
    organisationId: club.org.id,
    videoId: video.id,
    processingJobId: out.clipsJob!.id,
  };
  return { matchId, videoId: video.id, data, clipsJobId: out.clipsJob!.id };
}

const usageFor = (matchId: string) =>
  rawDb.usageEvent
    .findMany({
      where: { organisationId: club.org.id, metric: "storage_bytes", sourceType: "Clip" },
    })
    .then((rows) => rows.filter((r) => (r.metadata as { matchId?: string }).matchId === matchId));

describe("handleClips", { timeout: 60_000 }, () => {
  it("cuts only the missing clips after a crash, and counts usage once", async () => {
    const { matchId, data, clipsJobId } = await setup(4);
    const first = fakeCutter({ failOn: 3 });
    await expect(
      handleClips(data, { retryCount: 0, retryLimit: 2 }, { cutter: first.cutter, concurrency: 1 }),
    ).rejects.toThrow(/clips failed/);
    const failed = await rawDb.processingJob.findUniqueOrThrow({ where: { id: clipsJobId } });
    expect(failed).toMatchObject({ status: "queued", attempts: 1 });
    expect(failed.errorMessage).not.toContain("secret");
    expect(await rawDb.clip.count({ where: { matchId } })).toBe(2);

    const second = fakeCutter();
    expect(
      await handleClips(data, { retryCount: 1, retryLimit: 2 }, { cutter: second.cutter }),
    ).toBe("succeeded");
    expect(second.cuts).toHaveLength(2);
    expect(await rawDb.clip.count({ where: { matchId } })).toBe(4);
    expect(await usageFor(matchId)).toHaveLength(4);
    const done = await rawDb.processingJob.findUniqueOrThrow({ where: { id: clipsJobId } });
    expect(done).toMatchObject({ status: "succeeded", attempts: 2 });
    expect(done.metadata).toMatchObject({ count: 4, cutThisAttempt: 2 });

    // A replayed delivery changes nothing.
    const third = fakeCutter();
    expect(
      await handleClips(data, { retryCount: 1, retryLimit: 2 }, { cutter: third.cutter }),
    ).toBe("skipped");
    expect(third.cuts).toHaveLength(0);
    expect(await usageFor(matchId)).toHaveLength(4);
  });

  it("settles without cutting when the footage is gone", async () => {
    const { videoId, data, clipsJobId } = await setup(2);
    await rawDb.video.update({ where: { id: videoId }, data: { deletedAt: new Date() } });
    const { cutter, cuts } = fakeCutter();
    expect(await handleClips(data, { retryCount: 0, retryLimit: 2 }, { cutter })).toBe("skipped");
    expect(cuts).toHaveLength(0);
    expect(
      await rawDb.processingJob.findUniqueOrThrow({ where: { id: clipsJobId } }),
    ).toMatchObject({ status: "failed", attempts: 0 });
  });

  it("fails the match on the third failure and alerts platform admins once", async () => {
    const { matchId, data, clipsJobId } = await setup(1);
    await rawDb.processingJob.update({ where: { id: clipsJobId }, data: { attempts: 2 } });
    const { cutter } = fakeCutter({ failOn: 1 });
    await expect(handleClips(data, { retryCount: 2, retryLimit: 2 }, { cutter })).rejects.toThrow();
    const row = await rawDb.processingJob.findUniqueOrThrow({ where: { id: clipsJobId } });
    expect(row).toMatchObject({ status: "failed", attempts: 3 });
    expect(row.alertedAt).not.toBeNull();
    expect((await rawDb.match.findUniqueOrThrow({ where: { id: matchId } })).status).toBe("failed");
    const sent = deliverMail.mock.calls.filter((c) =>
      String((c as unknown[])[1]).includes(clipsJobId),
    );
    expect(sent.length).toBeGreaterThan(0);
  });

  it("succeeds at once with no events", async () => {
    const { data, clipsJobId } = await setup(0);
    const { cutter, cuts } = fakeCutter();
    expect(await handleClips(data, { retryCount: 0, retryLimit: 2 }, { cutter })).toBe("succeeded");
    expect(cuts).toHaveLength(0);
    const row = await rawDb.processingJob.findUniqueOrThrow({ where: { id: clipsJobId } });
    expect(row.status).toBe("succeeded");
    expect(row.metadata).toMatchObject({ count: 0 });
  });
});
