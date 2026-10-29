import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db/raw";
import { processingSummary } from "@/server/processing/summary";
import { fixtures } from "./helpers/fixtures";
import { match, setupClub } from "./helpers/matches";
import { cvJob } from "./helpers/cv";
import { acceptedVideo } from "./helpers/transcode";

// C07 (MATCH07, Surface 2): the match page's processing summary reads the
// accepted video's transcode job (C08: and its cv job). A video deleted into its 7-day hold
// (deletedAt set) is not processing, so the summary ignores it, as
// playableVideo() does.

const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;
let matchId: string;
let videoId: string;

beforeAll(async () => {
  club = await setupClub(f, "Summary FC");
  matchId = (await match(club.ctx, club.own.id, club.opposition.id)).id;
  videoId = (await acceptedVideo(club.org.id, matchId)).video.id;
  await cvJob(club.org.id, matchId, videoId);
});

afterAll(async () => {
  await f.cleanup();
});

describe("processingSummary", () => {
  it("shows the accepted video's transcode and cv jobs", async () => {
    const summary = await processingSummary(club.ctx, matchId);
    expect(summary?.transcode?.status).toBe("queued");
    expect(summary?.cv).toEqual({
      status: "queued",
      attempts: 0,
      maxAttempts: 3,
      startedAt: null,
      finishedAt: null,
    });
  });

  it("returns null once the video is deleted (in its hold period)", async () => {
    await rawDb.video.update({ where: { id: videoId }, data: { deletedAt: new Date() } });
    expect(await processingSummary(club.ctx, matchId)).toBeNull();
  });
});
