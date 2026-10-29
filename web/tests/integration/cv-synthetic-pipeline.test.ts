import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { clipExpiry } from "@/server/clips/expiry";
import { ingestCvResult } from "@/server/cv/ingest";
import { rawDb } from "@/server/db/raw";
import { moveToAwaitingReviewIfReady } from "@/server/processing/readiness";
import { handleClips } from "@/worker/clips";
import { fakeCutter, goldenResult, goldenTracks, ingestInput } from "./helpers/clips";
import { onLineup, placeholder, playerWithConsent, runningCvJob } from "./helpers/cv";
import { fixtures } from "./helpers/fixtures";
import { match, setupClub } from "./helpers/matches";
import { acceptedVideo } from "./helpers/transcode";

// C09 acceptance in CI ("synthetic end-to-end goes from upload, to processing,
// to events in the database"): the committed golden synthetic result
// (cv_worker `make cv-golden`) goes through the real ingest, the clips job
// runs with a fake cutter (no ffmpeg or S3 in CI), the transcode finishes,
// and the match is review-ready with one clip per event. Home #7 is a
// consented adult; home #9 a non-consented minor; the away side's #4 and #8
// are opposition placeholders. The local Playwright spec
// (tests/e2e/cv-pipeline.spec.ts) runs the same chain with the real worker.

vi.mock("@/server/consent/jobs", () => ({ enqueueConsentWithdrawn: vi.fn(async () => {}) }));
vi.mock("@/server/mail-transport", () => ({ deliverMail: vi.fn(async () => {}) }));

const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;

beforeAll(async () => {
  club = await setupClub(f, "Synthetic FC");
});

afterAll(async () => {
  await f.cleanup();
});

describe(
  "the synthetic pipeline through ingest and clips (acceptance)",
  { timeout: 60_000 },
  () => {
    it("ends review-ready with events, clips, usage and #7's positions", async () => {
      const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
      const { video, job: transcode } = await acceptedVideo(club.org.id, matchId, {
        durationSec: 90,
      });
      const adult = await playerWithConsent(club.ctx, club.own.id, "club_only", 25);
      const minor = await playerWithConsent(club.ctx, club.own.id, "none", 14);
      await onLineup(club.org.id, matchId, club.own.id, adult.id, 7);
      await onLineup(club.org.id, matchId, club.own.id, minor.id, 9);
      for (const n of [4, 8]) {
        const opp = await placeholder(club.org.id, club.opposition.id);
        await onLineup(club.org.id, matchId, club.opposition.id, opp.id, n);
      }

      const job = await runningCvJob(club.org.id, matchId, video.id);
      const result = goldenResult(job);
      expect(result.modelVersions.detector).toBe("synthetic-1");
      expect(goldenTracks(result, "home", 7).length).toBeGreaterThan(0);
      expect(goldenTracks(result, "home", 9).length).toBeGreaterThan(0);

      const out = await ingestCvResult(ingestInput(job, video.id, result));
      expect(out.ingested).toBe(true);
      expect(out.clipsJob).not.toBeNull();
      expect(out.counts.events).toBe(result.events.length);

      // The clips job, then the transcode, as the workers would finish them.
      const { cutter, cuts } = fakeCutter();
      const clipsData = {
        organisationId: club.org.id,
        videoId: video.id,
        processingJobId: out.clipsJob!.id,
      };
      expect(await handleClips(clipsData, { retryCount: 0, retryLimit: 2 }, { cutter })).toBe(
        "succeeded",
      );
      await rawDb.$transaction(async (tx) => {
        await tx.processingJob.update({
          where: { id: transcode.id },
          data: { status: "succeeded", attempts: 1, startedAt: new Date(), finishedAt: new Date() },
        });
        await moveToAwaitingReviewIfReady(tx, {
          organisationId: club.org.id,
          matchId,
          videoId: video.id,
        });
      });

      expect((await rawDb.match.findUniqueOrThrow({ where: { id: matchId } })).status).toBe(
        "awaiting_review",
      );
      const events = await rawDb.event.findMany({ where: { matchId }, select: { type: true } });
      expect(events.length).toBe(result.events.length);
      expect(new Set(events.map((e) => e.type))).toEqual(new Set(["goal", "shot", "touch"]));
      const clips = await rawDb.clip.findMany({ where: { matchId } });
      expect(clips).toHaveLength(events.length);
      expect(cuts).toHaveLength(events.length);
      const expiry = clipExpiry(video.uploadedAt!).getTime();
      for (const c of clips) {
        expect(c.expiresAt?.getTime()).toBe(expiry);
        expect(c.baseExpiresAt.getTime()).toBe(expiry);
        expect(c.blobPath).toBe(`orgs/${club.org.id}/matches/${matchId}/clips/${c.eventId}.mp4`);
        expect(c.endMs).toBeGreaterThan(c.startMs);
        expect(c.endMs).toBeLessThanOrEqual(90_000);
      }
      const usage = await rawDb.usageEvent.findMany({
        where: { organisationId: club.org.id, metric: "storage_bytes", sourceType: "Clip" },
      });
      const ofMatch = usage.filter((u) => (u.metadata as { matchId?: string }).matchId === matchId);
      expect(ofMatch).toHaveLength(clips.length);

      // #7 (a consented adult) has linked tracks with positions and distance.
      const sevens = await rawDb.track.findMany({
        where: { matchId, playerId: adult.id },
        select: { id: true, distanceM: true, _count: { select: { points: true } } },
      });
      expect(sevens.length).toBeGreaterThan(0);
      for (const t of sevens) {
        expect(t.distanceM).toBeGreaterThan(0);
        expect(t._count.points).toBeGreaterThan(0);
      }
      const job2 = await rawDb.processingJob.findUniqueOrThrow({ where: { id: out.clipsJob!.id } });
      expect(job2).toMatchObject({ status: "succeeded" });
      expect(job2.metadata).toMatchObject({ count: clips.length });
    });
  },
);
