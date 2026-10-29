import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db/raw";
import { fixtures } from "./helpers/fixtures";
import { runningCvJob } from "./helpers/cv";
import { match, setupClub } from "./helpers/matches";
import { acceptedVideo } from "./helpers/transcode";

// C08 (README "Before the pilot"): TrackPoint is hash-partitioned by match in
// raw SQL, 16 partitions in schema trackpoint_parts. A match's points sit in
// one partition, coordinates off the pitch are refused, and deleting the match
// removes its points.

const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;

beforeAll(async () => {
  club = await setupClub(f, "Partition FC");
});

afterAll(async () => {
  await f.cleanup();
});

describe("TrackPoint partitions", () => {
  it("is a hash-partitioned table with 16 children", async () => {
    const [part] = await rawDb.$queryRaw<{ strategy: string }[]>`
      SELECT partstrat::text AS strategy FROM pg_partitioned_table
      WHERE partrelid = '"TrackPoint"'::regclass`;
    expect(part?.strategy).toBe("h");
    const children = await rawDb.$queryRaw<{ name: string }[]>`
      SELECT c.relnamespace::regnamespace::text || '.' || c.relname AS name
      FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = '"TrackPoint"'::regclass ORDER BY 1`;
    expect(children).toHaveLength(16);
    expect(children.every((c) => c.name.startsWith("trackpoint_parts.p"))).toBe(true);
  });

  it("keeps a match's points in one partition, checks the pitch, and cascades", async () => {
    const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
    const { video } = await acceptedVideo(club.org.id, matchId);
    const job = await runningCvJob(club.org.id, matchId, video.id);
    const track = await rawDb.track.create({
      data: {
        organisationId: club.org.id,
        matchId,
        jobId: job.id,
        trackIndex: 0,
        teamSide: "home",
      },
    });
    await rawDb.trackPoint.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        organisationId: club.org.id,
        matchId,
        trackId: track.id,
        tMs: i * 200,
        x: 50,
        y: 30,
      })),
    });
    const parts = await rawDb.$queryRaw<{ part: string }[]>`
      SELECT DISTINCT tableoid::regclass::text AS part FROM "TrackPoint" WHERE "matchId" = ${matchId}`;
    expect(parts).toHaveLength(1);

    await expect(
      rawDb.trackPoint.create({
        data: {
          organisationId: club.org.id,
          matchId,
          trackId: track.id,
          tMs: 99_999,
          x: 106,
          y: 30,
        },
      }),
    ).rejects.toThrow(/TrackPoint_coords/);

    await rawDb.match.delete({ where: { id: matchId } });
    expect(await rawDb.trackPoint.count({ where: { matchId } })).toBe(0);
  });
});
