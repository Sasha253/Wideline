import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ingestCvResult, swapSides, teamSideEvidence } from "@/server/cv/ingest";
import { rawDb } from "@/server/db/raw";
import { ingestInput } from "./helpers/clips";
import {
  onLineup,
  placeholder,
  playerWithConsent,
  result,
  runningCvJob,
  track,
} from "./helpers/cv";
import { fixtures } from "./helpers/fixtures";
import { match, setupClub } from "./helpers/matches";
import { acceptedVideo } from "./helpers/transcode";

// C09 (Q-041): kit clustering cannot tell home from away, so ingest swaps the
// sides when the lineups' shirt numbers explain strictly more reads the other
// way round. The swap comes before the consent gate, so it changes which
// player a number links to.

vi.mock("@/server/consent/jobs", () => ({ enqueueConsentWithdrawn: vi.fn(async () => {}) }));

const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;

beforeAll(async () => {
  club = await setupClub(f, "Swap FC");
});

afterAll(async () => {
  await f.cleanup();
});

describe("teamSideEvidence", () => {
  const numbers = { home: new Set([7]), away: new Set([9, 10]) };

  it("counts reads each way, confident reads only", () => {
    const tracks = [
      track(0, "home", 9, 0.9),
      track(1, "home", 10, 0.8),
      track(2, "away", 7, 0.7),
      track(3, "away", 9, 0.3),
      track(4, "unknown", 7, 0.9),
    ];
    expect(teamSideEvidence(tracks, numbers)).toEqual({ kept: 0, swapped: 3 });
    expect(swapSides(tracks).map((t) => t.teamSide)).toEqual([
      "away",
      "away",
      "home",
      "home",
      "unknown",
    ]);
  });
});

describe("ingest side choice", () => {
  async function setup() {
    const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
    const { video } = await acceptedVideo(club.org.id, matchId);
    const seven = await playerWithConsent(club.ctx, club.own.id, "club_only", 22);
    await onLineup(club.org.id, matchId, club.own.id, seven.id, 7);
    for (const n of [9, 10]) {
      const opp = await placeholder(club.org.id, club.opposition.id);
      await onLineup(club.org.id, matchId, club.opposition.id, opp.id, n);
    }
    const job = await runningCvJob(club.org.id, matchId, video.id);
    return { matchId, videoId: video.id, job, seven };
  }

  it("swaps when the other way explains strictly more reads, before linking", async () => {
    const { matchId, videoId, job, seven } = await setup();
    const r = result(job, [
      track(0, "home", 9, 0.9),
      track(1, "home", 10, 0.8),
      track(2, "away", 7, 0.9),
    ]);
    await ingestCvResult(ingestInput(job, videoId, r));
    const rows = await rawDb.track.findMany({ where: { matchId }, orderBy: { trackIndex: "asc" } });
    // #7 read on the "away" kit is the home #7 after the swap, and is linked.
    expect(rows.map((t) => [t.trackIndex, t.teamSide, t.playerId])).toEqual([
      [2, "home", seven.id],
    ]);
    const meta = (await rawDb.processingJob.findUniqueOrThrow({ where: { id: job.id } }))
      .metadata as {
      teamSideSwapped: boolean;
      teamSideEvidence: { kept: number; swapped: number };
    };
    expect(meta.teamSideSwapped).toBe(true);
    expect(meta.teamSideEvidence).toEqual({ kept: 0, swapped: 3 });
  });

  it("keeps the sides on equal evidence", async () => {
    const { matchId, videoId, job, seven } = await setup();
    const r = result(job, [track(0, "home", 7, 0.9), track(1, "home", 9, 0.9)]);
    await ingestCvResult(ingestInput(job, videoId, r));
    const linked = await rawDb.track.findFirst({ where: { matchId, playerId: seven.id } });
    expect(linked?.teamSide).toBe("home");
    const meta = (await rawDb.processingJob.findUniqueOrThrow({ where: { id: job.id } }))
      .metadata as { teamSideSwapped: boolean };
    expect(meta.teamSideSwapped).toBe(false);
  });
});
