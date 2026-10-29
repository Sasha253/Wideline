import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { withdrawConsent } from "@/server/consent/records";
import { ingestCvResult } from "@/server/cv/ingest";
import { purgeUnattributablePlayerTracks } from "@/server/cv/withdrawal";
import { rawDb } from "@/server/db/raw";
import { fixtures } from "./helpers/fixtures";
import { event, onLineup, playerWithConsent, result, runningCvJob, track } from "./helpers/cv";
import { match, setupClub } from "./helpers/matches";
import { acceptedVideo } from "./helpers/transcode";

// C08 acceptance (NFR08, PRD "POPIA and privacy"): the consent gate sits at
// ingest. A non-consented minor gets no track, no track points and no event
// attributed; the event on their track is kept at team level only. A withdrawn
// adult is refused the same way (Q-018: consent for every age). Club-only and
// scout-visible players are linked. When consent is withdrawn later, the
// consent-withdrawn purge deletes the player's tracks and points and unlinks
// their events (NFR11).

vi.mock("@/server/consent/jobs", () => ({ enqueueConsentWithdrawn: vi.fn(async () => {}) }));

const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;

beforeAll(async () => {
  club = await setupClub(f, "Gate FC");
});

afterAll(async () => {
  await f.cleanup();
});

async function ingestFor(players: { id: string; shirt: number }[]) {
  const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
  const { video } = await acceptedVideo(club.org.id, matchId);
  const job = await runningCvJob(club.org.id, matchId, video.id);
  for (const p of players) await onLineup(club.org.id, matchId, club.own.id, p.id, p.shirt);
  await ingestCvResult({
    job,
    videoId: video.id,
    result: result(
      job,
      players.map((p, i) => track(i, "home", p.shirt, 0.9, 5)),
      players.map((_p, i) => event("shot", i, 0.9, 60_000 + i * 1000)),
    ),
    resultKey: "k",
    resultBytes: 10,
    resultSha256: "b".repeat(64),
    attempt: 1,
    provider: "fake",
    realtimeFactor: null,
    startupMs: null,
  });
  return matchId;
}

async function dataFor(matchId: string, playerId: string) {
  const tracks = await rawDb.track.findMany({ where: { matchId, playerId }, select: { id: true } });
  return {
    tracks: tracks.length,
    points: await rawDb.trackPoint.count({
      where: { matchId, trackId: { in: tracks.map((t) => t.id) } },
    }),
    events: await rawDb.event.count({ where: { matchId, playerId } }),
  };
}

describe("the consent gate at ingest (acceptance)", () => {
  it("keeps nothing against a non-consented minor", async () => {
    const minor = await playerWithConsent(club.ctx, club.own.id, "none", 14);
    const matchId = await ingestFor([{ id: minor.id, shirt: 10 }]);
    expect(await dataFor(matchId, minor.id)).toEqual({ tracks: 0, points: 0, events: 0 });
    // No track at all was stored for that shirt, so no points either.
    expect(await rawDb.track.count({ where: { matchId } })).toBe(0);
    expect(await rawDb.trackPoint.count({ where: { matchId } })).toBe(0);
    // The shot is kept at team level, with no track, player or position.
    const [shot] = await rawDb.event.findMany({ where: { matchId } });
    expect(shot).toMatchObject({
      teamSide: "home",
      trackId: null,
      playerId: null,
      pitchX: null,
      pitchY: null,
    });
  });

  it("refuses a withdrawn adult the same way", async () => {
    const adult = await playerWithConsent(club.ctx, club.own.id, "withdrawn", 20);
    const matchId = await ingestFor([{ id: adult.id, shirt: 11 }]);
    expect(await dataFor(matchId, adult.id)).toEqual({ tracks: 0, points: 0, events: 0 });
  });

  it("links club-only and scout-visible players", async () => {
    const a = await playerWithConsent(club.ctx, club.own.id, "club_only");
    const b = await playerWithConsent(club.ctx, club.own.id, "scout_visible");
    const matchId = await ingestFor([
      { id: a.id, shirt: 7 },
      { id: b.id, shirt: 9 },
    ]);
    expect(await dataFor(matchId, a.id)).toEqual({ tracks: 1, points: 5, events: 1 });
    expect(await dataFor(matchId, b.id)).toEqual({ tracks: 1, points: 5, events: 1 });
  });
});

describe("the consent-withdrawn purge (NFR11)", () => {
  it("deletes the player's tracks and points and unlinks their events", async () => {
    const p = await playerWithConsent(club.ctx, club.own.id, "scout_visible");
    const other = await playerWithConsent(club.ctx, club.own.id, "club_only");
    const matchId = await ingestFor([
      { id: p.id, shirt: 4 },
      { id: other.id, shirt: 5 },
    ]);
    expect(await dataFor(matchId, p.id)).toEqual({ tracks: 1, points: 5, events: 1 });

    // Still granted: nothing is purged.
    expect(await purgeUnattributablePlayerTracks(club.org.id, p.id)).toEqual({
      tracks: 0,
      events: 0,
    });

    await withdrawConsent(club.ctx, p.id, { requestedBy: "Thandi Mokoena", method: "in_person" });
    expect(await purgeUnattributablePlayerTracks(club.org.id, p.id)).toEqual({
      tracks: 1,
      events: 1,
    });
    expect(await dataFor(matchId, p.id)).toEqual({ tracks: 0, points: 0, events: 0 });
    const events = await rawDb.event.findMany({
      where: { matchId },
      orderBy: { timestampMs: "asc" },
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      playerId: null,
      trackId: null,
      pitchX: null,
      teamSide: "home",
    });
    // The other player keeps everything.
    expect(await dataFor(matchId, other.id)).toEqual({ tracks: 1, points: 5, events: 1 });
  });
});

describe("a withdrawal racing an ingest (NFR08, CONS03)", () => {
  // Ingest reads consent, then writes tracks for minutes. A withdrawal that
  // commits in between has its purge run before the tracks exist, so ingest
  // re-checks consent just before commit and drops the refused player. It
  // holds no lock on the player while it writes, so the withdrawal itself
  // never waits on ingest (a consent write has Prisma's 5 s timeout).

  /**
   * Starts an ingest for one linked player and holds it after the plan.
   * "plan" holds it at its first Track insert: after the plan's consent read,
   * before any write. "writes" holds it at its Event insert: the Tracks and
   * points are written, so the foreign key check on Track.playerId holds a
   * key-share lock on the player, and the re-check has not run.
   */
  async function heldIngest(shirt: number, at: "plan" | "writes" = "plan") {
    const p = await playerWithConsent(club.ctx, club.own.id, "scout_visible");
    const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
    const { video } = await acceptedVideo(club.org.id, matchId);
    const job = await runningCvJob(club.org.id, matchId, video.id);
    await onLineup(club.org.id, matchId, club.own.id, p.id, shirt);

    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let held!: () => void;
    const holding = new Promise<void>((r) => (held = r));
    const blocker = rawDb.$transaction(
      async (tx) => {
        if (at === "plan") {
          // The Track insert's foreign key needs a key-share lock on the job row.
          await tx.$queryRaw`SELECT 1 FROM "ProcessingJob" WHERE "id" = ${job.id} FOR UPDATE`;
        } else {
          // SHARE mode lets reads through and stops every insert into Event.
          await tx.$executeRaw`LOCK TABLE "Event" IN SHARE MODE`;
        }
        held();
        await released;
      },
      { timeout: 60_000 },
    );
    await holding;

    let ingestDone = false;
    const ingest = ingestCvResult({
      job,
      videoId: video.id,
      result: result(job, [track(0, "home", shirt, 0.9, 5)], [event("shot", 0, 0.9, 60_000)]),
      resultKey: "k",
      resultBytes: 10,
      resultSha256: "c".repeat(64),
      attempt: 1,
      provider: "fake",
      realtimeFactor: null,
      startupMs: null,
    }).finally(() => (ingestDone = true));
    await waitForLockWaiters(1, at === "plan" ? "Track" : "Event");
    return {
      p,
      matchId,
      ingest,
      isDone: () => ingestDone,
      finish: async () => {
        release();
        await blocker;
        return ingest;
      },
    };
  }

  it("drops the player when the withdrawal commits after the plan", async () => {
    const run = await heldIngest(6);
    // The consent-withdrawn job runs once the withdrawal has committed. The
    // tracks do not exist yet, so the purge finds nothing.
    await withdrawConsent(club.ctx, run.p.id, {
      requestedBy: "Thandi Mokoena",
      method: "in_person",
    });
    expect(await purgeUnattributablePlayerTracks(club.org.id, run.p.id)).toEqual({
      tracks: 0,
      events: 0,
    });

    const outcome = await run.finish();
    expect(outcome.ingested).toBe(true);
    expect(outcome.counts).toMatchObject({ tracks: 0, linked: 0, discarded: 1, points: 0 });
    expect(await dataFor(run.matchId, run.p.id)).toEqual({ tracks: 0, points: 0, events: 0 });
    expect(await rawDb.track.count({ where: { matchId: run.matchId } })).toBe(0);
    expect(await rawDb.trackPoint.count({ where: { matchId: run.matchId } })).toBe(0);
    // The shot stays at team level.
    const [shot] = await rawDb.event.findMany({ where: { matchId: run.matchId } });
    expect(shot).toMatchObject({ teamSide: "home", trackId: null, playerId: null, pitchX: null });
  }, 30_000);

  it("lets a consent write finish while a long ingest is still writing", async () => {
    const run = await heldIngest(8, "writes");
    // Hold ingest well past the 5 s interactive-transaction timeout before
    // the consent write starts, with the player's Track already inserted, so
    // the write meets the foreign key's key-share lock on the player.
    await new Promise((r) => setTimeout(r, 6_000));
    // Bounded, so a write stuck behind a held lock fails here instead of hanging.
    const outcome = await Promise.race([
      withdrawConsent(club.ctx, run.p.id, {
        requestedBy: "Thandi Mokoena",
        method: "in_person",
      }).then(() => "written" as const),
      new Promise<"blocked">((r) => setTimeout(() => r("blocked"), 10_000)),
    ]);
    expect(outcome).toBe("written");
    // The withdrawal finished while ingest was still held.
    expect(run.isDone()).toBe(false);

    await run.finish();
    await purgeUnattributablePlayerTracks(club.org.id, run.p.id);
    expect(await dataFor(run.matchId, run.p.id)).toEqual({ tracks: 0, points: 0, events: 0 });
  }, 60_000);
});

/** Waits until this many backends are blocked on a lock while inserting into `table`. */
async function waitForLockWaiters(n: number, table: "Track" | "Event") {
  const pattern = `%INSERT INTO%"${table}"%`;
  for (let i = 0; i < 100; i++) {
    const [row] = await rawDb.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'
         AND query LIKE ${pattern}`;
    if (Number(row?.n ?? 0) >= n) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`ingest never blocked on its ${table} insert`);
}
