import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ingestCvResult, type IngestInput } from "@/server/cv/ingest";
import { rawDb } from "@/server/db/raw";
import { fixtures } from "./helpers/fixtures";
import {
  event,
  onLineup,
  placeholder,
  playerWithConsent,
  result,
  runningCvJob,
  track,
  transcodeDone,
} from "./helpers/cv";
import { match, setupClub } from "./helpers/matches";
import { acceptedVideo } from "./helpers/transcode";

// C08 acceptance (NFR06): ingesting the same result twice changes nothing.
// One result with linked consented players, a non-consented minor, an
// opposition placeholder, a low-confidence and an unknown track, and events
// above and below their thresholds. A second ingest finds the job settled and
// changes nothing; forced through again (the job put back to running), every
// key holds and the rows, statuses, usage, metadata and match are identical.
// Event status follows the organisation's own thresholds (REVIEW10).

vi.mock("@/server/consent/jobs", () => ({ enqueueConsentWithdrawn: vi.fn(async () => {}) }));

const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;

beforeAll(async () => {
  club = await setupClub(f, "Ingest FC");
});

afterAll(async () => {
  await f.cleanup();
});

/** Everything an ingest writes for a match, in a comparable form. */
async function snapshot(matchId: string, jobId: string) {
  const [tracks, points, events, usage, job, m] = await Promise.all([
    rawDb.track.findMany({
      where: { matchId },
      orderBy: { trackIndex: "asc" },
      select: { id: true, trackIndex: true, teamSide: true, playerId: true, linkedBy: true },
    }),
    rawDb.trackPoint.count({ where: { matchId } }),
    rawDb.event.findMany({
      where: { matchId },
      orderBy: { sourceKey: "asc" },
      select: {
        id: true,
        sourceKey: true,
        status: true,
        trackId: true,
        playerId: true,
        teamSide: true,
        pitchX: true,
      },
    }),
    rawDb.usageEvent.findMany({
      where: { sourceType: "CvResult", sourceId: { startsWith: jobId } },
      select: { id: true, quantity: true },
    }),
    rawDb.processingJob.findUniqueOrThrow({
      where: { id: jobId },
      select: { status: true, metadata: true, modelVersion: true, gpuProvider: true },
    }),
    rawDb.match.findUniqueOrThrow({ where: { id: matchId }, select: { status: true } }),
  ]);
  return { tracks, points, events, usage, job, match: m.status };
}

async function setup() {
  const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
  const { video, job: transcode } = await acceptedVideo(club.org.id, matchId);
  const job = await runningCvJob(club.org.id, matchId, video.id);
  return { matchId, videoId: video.id, transcodeId: transcode.id, job };
}

function input(job: IngestInput["job"], videoId: string, r: IngestInput["result"]): IngestInput {
  return {
    job,
    videoId,
    result: r,
    resultKey: `orgs/${job.organisationId}/matches/${job.matchId}/cv/${job.id}/attempt-1/result.json`,
    resultBytes: 2048,
    resultSha256: "a".repeat(64),
    attempt: 1,
    provider: "fake",
    realtimeFactor: 0.5,
    startupMs: 1200,
  };
}

describe("cv ingest", () => {
  it("writes tracks, points and events once, through the consent gate (acceptance)", async () => {
    const { matchId, videoId, transcodeId, job } = await setup();
    await transcodeDone(transcodeId);
    const clubOnly = await playerWithConsent(club.ctx, club.own.id, "club_only");
    const scoutVisible = await playerWithConsent(club.ctx, club.own.id, "scout_visible");
    const noConsent = await playerWithConsent(club.ctx, club.own.id, "none");
    const opp = await placeholder(club.org.id, club.opposition.id);
    await onLineup(club.org.id, matchId, club.own.id, clubOnly.id, 7);
    await onLineup(club.org.id, matchId, club.own.id, scoutVisible.id, 9);
    await onLineup(club.org.id, matchId, club.own.id, noConsent.id, 10);
    await onLineup(club.org.id, matchId, club.opposition.id, opp.id, 4);

    const r = result(
      job,
      [
        track(0, "home", 7, 0.9),
        track(1, "home", 9, 0.8),
        track(2, "home", 10, 0.95),
        track(3, "away", 4, 0.9),
        track(4, "home", 7, 0.3),
        track(5, "unknown", null, null),
      ],
      [
        event("goal", 0, 0.95, 60_000),
        event("shot", 1, 0.8, 61_000),
        event("shot", 2, 0.9, 62_000),
        event("touch", 4, 0.5, 63_000),
        event("goal", null, 0.5, 64_000),
      ],
    );

    const first = await ingestCvResult(input(job, videoId, r));
    expect(first).toMatchObject({ ingested: true, matchReady: true });
    expect(first.counts).toEqual({
      tracks: 4,
      linked: 2,
      discarded: 2,
      unlinked: 2,
      points: 12,
      events: 5,
      autoAccepted: 3,
      pendingReview: 2,
    });

    const before = await snapshot(matchId, job.id);
    expect(before.tracks.map((t) => [t.trackIndex, t.playerId, t.linkedBy])).toEqual([
      [0, clubOnly.id, "cv"],
      [1, scoutVisible.id, "cv"],
      [4, null, null],
      [5, null, null],
    ]);
    expect(before.points).toBe(12);
    const bySource = Object.fromEntries(before.events.map((e) => [e.sourceKey, e]));
    expect(bySource["goal@60000#0"]).toMatchObject({
      status: "auto_accepted",
      playerId: clubOnly.id,
    });
    expect(bySource["shot@61000#1"]).toMatchObject({
      status: "auto_accepted",
      playerId: scoutVisible.id,
    });
    // The non-consented minor's shot keeps its team side only (NFR08).
    expect(bySource["shot@62000#2"]).toMatchObject({
      status: "auto_accepted",
      trackId: null,
      playerId: null,
      teamSide: "home",
      pitchX: null,
    });
    expect(bySource["touch@63000#4"]).toMatchObject({ status: "pending_review", playerId: null });
    expect(bySource["touch@63000#4"]!.trackId).not.toBeNull();
    expect(bySource["goal@64000#none"]).toMatchObject({ status: "pending_review", trackId: null });
    expect(before.usage).toHaveLength(1);
    expect(before.job).toMatchObject({
      status: "succeeded",
      modelVersion: "stub-0+stub-0+stub-0",
      gpuProvider: "fake",
    });
    expect(JSON.stringify(before.job.metadata)).not.toContain(clubOnly.id);
    expect(before.match).toBe("awaiting_review");

    // Again: the job has settled, so nothing changes.
    const second = await ingestCvResult(input(job, videoId, r));
    expect(second.ingested).toBe(false);
    expect(await snapshot(matchId, job.id)).toEqual(before);

    // Forced through (the job put back to running): every key holds.
    await rawDb.processingJob.update({ where: { id: job.id }, data: { status: "running" } });
    const third = await ingestCvResult(input(job, videoId, r));
    expect(third.ingested).toBe(true);
    expect(third.counts).toEqual(first.counts);
    expect(await snapshot(matchId, job.id)).toEqual(before);
  });

  it("keeps the match in Processing until the transcode has succeeded too", async () => {
    const { matchId, videoId, job } = await setup();
    const out = await ingestCvResult(input(job, videoId, result(job)));
    expect(out).toMatchObject({ ingested: true, matchReady: false });
    expect((await rawDb.match.findUniqueOrThrow({ where: { id: matchId } })).status).toBe(
      "processing",
    );
  });

  it("follows the organisation's own thresholds (REVIEW10)", async () => {
    await rawDb.organisation.update({
      where: { id: club.org.id },
      data: { settings: { autoAccept: { shot: 0.85 } } },
    });
    try {
      const { matchId, videoId, job } = await setup();
      await ingestCvResult(
        input(
          job,
          videoId,
          result(job, [], [event("shot", null, 0.8), event("goal", null, 0.92, 70_000)]),
        ),
      );
      const events = await rawDb.event.findMany({
        where: { matchId },
        orderBy: { timestampMs: "asc" },
      });
      expect(events.map((e) => [e.type, e.status])).toEqual([
        ["shot", "pending_review"],
        ["goal", "auto_accepted"],
      ]);
      const meta = (await rawDb.processingJob.findUniqueOrThrow({ where: { id: job.id } }))
        .metadata as { thresholds: Record<string, number> };
      expect(meta.thresholds).toEqual({ goal: 0.9, shot: 0.85, touch: 0.8 });
    } finally {
      await rawDb.organisation.update({ where: { id: club.org.id }, data: { settings: {} } });
    }
  });
});
