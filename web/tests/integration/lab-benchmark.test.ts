import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ingestCvResult } from "@/server/cv/ingest";
import { rawDb } from "@/server/db/raw";
import { benchmarkByModel, labMatchRows, matchBenchmark } from "@/server/lab/benchmark";
import { importTags, TagImportError } from "@/server/lab/tags";
import { moveToAwaitingReviewIfReady } from "@/server/processing/readiness";
import { handleClips } from "@/worker/clips";
import { fakeCutter, GOLDEN_TRUTH, goldenResult, ingestInput } from "./helpers/clips";
import { runningCvJob } from "./helpers/cv";
import { fixtures } from "./helpers/fixtures";
import { match, setupClub } from "./helpers/matches";
import { acceptedVideo } from "./helpers/transcode";

// C09 (Q-046, NFR01): the Lab's tag import, recall per match and per model
// version, and upload to review-ready, on the golden synthetic run and its
// committed truth CSV.

vi.mock("@/server/consent/jobs", () => ({ enqueueConsentWithdrawn: vi.fn(async () => {}) }));
vi.mock("@/server/mail-transport", () => ({ deliverMail: vi.fn(async () => {}) }));

const f = fixtures();
let lab: Awaited<ReturnType<typeof setupClub>>;

beforeAll(async () => {
  lab = await setupClub(f, "Lab Bench");
});

afterAll(async () => {
  await f.cleanup();
});

describe("Lab benchmark", { timeout: 60_000 }, () => {
  it("imports tags, measures recall per match and per version, and times review-ready", async () => {
    const { id: matchId } = await match(lab.ctx, lab.own.id, lab.opposition.id);
    const { video, job: transcode } = await acceptedVideo(lab.org.id, matchId, { durationSec: 90 });
    const job = await runningCvJob(lab.org.id, matchId, video.id);
    const out = await ingestCvResult(ingestInput(job, video.id, goldenResult(job)));
    await handleClips(
      { organisationId: lab.org.id, videoId: video.id, processingJobId: out.clipsJob!.id },
      { retryCount: 0, retryLimit: 2 },
      { cutter: fakeCutter().cutter },
    );
    await rawDb.$transaction(async (tx) => {
      await tx.processingJob.update({
        where: { id: transcode.id },
        data: { status: "succeeded", attempts: 1, finishedAt: new Date() },
      });
      await moveToAwaitingReviewIfReady(tx, {
        organisationId: lab.org.id,
        matchId,
        videoId: video.id,
      });
    });

    // Before any tags: no recall.
    expect((await matchBenchmark(lab.ctx, matchId))!.recall).toBeNull();

    const csv = readFileSync(GOLDEN_TRUTH, "utf8");
    const imported = await importTags(lab.ctx, matchId, "synthetic", csv);
    expect(imported.count).toBe(csv.trim().split(/\r?\n/).length - 1);
    expect(imported.goal).toBeGreaterThan(0);
    expect(
      await rawDb.auditLog.count({
        where: { organisationId: lab.org.id, action: "benchmark_tags.imported", targetId: matchId },
      }),
    ).toBe(1);

    const b = (await matchBenchmark(lab.ctx, matchId))!;
    const row = (t: string) => b.recall!.rows.find((r) => r.type === t)!;
    expect(row("goal")).toMatchObject({ tagged: imported.goal, matched: imported.goal });
    expect(row("shot").matched).toBe(row("shot").tagged);
    expect(b.tagCounts).toEqual({ hand: 0, synthetic: imported.count, soccernet: 0 });
    expect(b.readySec).not.toBeNull();
    expect(b.calibration?.source).toBe("fallback");

    // The list and the per-version aggregate agree.
    const rows = await labMatchRows(lab.ctx);
    const listed = rows.find((r) => r.id === matchId)!;
    expect(listed.recall?.map((r) => r.type)).toEqual(["goal", "shot"]);
    expect(listed.readySec).toBe(b.readySec);
    const versions = await benchmarkByModel(lab.ctx);
    const v = versions.find((x) => x.modelVersion.startsWith("synthetic-1+"))!;
    expect(v.matches).toBe(1);
    expect(v.rows.find((r) => r.type === "goal")).toMatchObject({ tagged: imported.goal });

    // Re-import replaces the same source only; a bad CSV changes nothing.
    await importTags(lab.ctx, matchId, "hand", "type,time,teamSide,onTarget\ngoal,0:37.7,home,\n");
    await expect(
      importTags(lab.ctx, matchId, "synthetic", "type,time,teamSide,onTarget\ngoal,soon,,\n"),
    ).rejects.toBeInstanceOf(TagImportError);
    expect(await rawDb.benchmarkTag.count({ where: { matchId, source: "synthetic" } })).toBe(
      imported.count,
    );
    expect(await rawDb.benchmarkTag.count({ where: { matchId, source: "hand" } })).toBe(1);
  });
});
