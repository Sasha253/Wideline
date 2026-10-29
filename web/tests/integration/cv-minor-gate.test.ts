import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { recordConsent, withdrawConsent } from "@/server/consent/records";
import { ingestCvResult, sourceKey } from "@/server/cv/ingest";
import { purgeUnattributablePlayerTracks } from "@/server/cv/withdrawal";
import { rawDb } from "@/server/db/raw";
import { handleClips } from "@/worker/clips";
import { fakeCutter, goldenResult, goldenTracks, ingestInput } from "./helpers/clips";
import { guardianGrant } from "./helpers/consent";
import { onLineup, placeholder, playerWithConsent, runningCvJob } from "./helpers/cv";
import { fixtures } from "./helpers/fixtures";
import { match, setupClub } from "./helpers/matches";
import { acceptedVideo } from "./helpers/transcode";

// C09 acceptance for NFR08 ("a non-consented minor gets no events and no track
// points retained"), with the golden synthetic result: home #9, a minor with
// no consent, reads clearly in several tracks and scores. Nothing per-player
// is kept for them: no Track for their (side, number), no TrackPoint, no
// attributed Event; their events stay at team level with no position. A
// later grant does not bring anything back on a repeated ingest (NFR06), and
// withdrawing the adult #7 purges #7's tracks while the clips stay, unlinked.

vi.mock("@/server/consent/jobs", () => ({ enqueueConsentWithdrawn: vi.fn(async () => {}) }));
vi.mock("@/server/mail-transport", () => ({ deliverMail: vi.fn(async () => {}) }));

const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;

beforeAll(async () => {
  club = await setupClub(f, "Minor Gate FC");
});

afterAll(async () => {
  await f.cleanup();
});

describe(
  "the consent gate with the synthetic pipeline (NFR08 acceptance)",
  { timeout: 60_000 },
  () => {
    it("keeps nothing per-player for a non-consented minor", async () => {
      const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
      const { video } = await acceptedVideo(club.org.id, matchId, { durationSec: 90 });
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
      const minorTracks = new Set(goldenTracks(result, "home", 9));
      const minorEvents = result.events.filter(
        (e) => e.trackIndex !== null && minorTracks.has(e.trackIndex),
      );
      expect(minorTracks.size).toBeGreaterThan(0);
      expect(minorEvents.length).toBeGreaterThan(0);

      const out = await ingestCvResult(ingestInput(job, video.id, result));
      expect(out.ingested).toBe(true);
      expect(out.counts.discarded).toBeGreaterThanOrEqual(minorTracks.size);

      // No Track for the minor's (side, number), none linked to them, no points.
      expect(
        await rawDb.track.count({ where: { matchId, teamSide: "home", shirtNumber: 9 } }),
      ).toBe(0);
      expect(await rawDb.track.count({ where: { playerId: minor.id } })).toBe(0);
      const kept = await rawDb.track.findMany({ where: { matchId }, select: { trackIndex: true } });
      for (const t of kept) expect(minorTracks.has(t.trackIndex)).toBe(false);
      expect(
        await rawDb.trackPoint.count({
          where: { matchId, track: { trackIndex: { in: [...minorTracks] } } },
        }),
      ).toBe(0);

      // No attributed Event; their events keep the team side only.
      expect(await rawDb.event.count({ where: { playerId: minor.id } })).toBe(0);
      for (const e of minorEvents) {
        const row = await rawDb.event.findFirstOrThrow({
          where: { jobId: job.id, sourceKey: sourceKey(e) },
        });
        expect(row).toMatchObject({
          teamSide: "home",
          trackId: null,
          playerId: null,
          pitchX: null,
          pitchY: null,
        });
      }

      // #7 is linked.
      expect(await rawDb.track.count({ where: { playerId: adult.id } })).toBeGreaterThan(0);

      // The clips are cut, the minor's team-level events included (Q-047), linked to nobody.
      const clipsJob = out.clipsJob!;
      const { cutter } = fakeCutter();
      await handleClips(
        { organisationId: club.org.id, videoId: video.id, processingJobId: clipsJob.id },
        { retryCount: 0, retryLimit: 2 },
        { cutter },
      );
      const clips = await rawDb.clip.count({ where: { matchId } });
      expect(clips).toBe(result.events.length);

      // A later grant changes nothing: a repeated ingest finds the job settled.
      await recordConsent(club.ctx, minor.id, guardianGrant({ scoutVisible: "no" }));
      const before = await rawDb.track.count({ where: { matchId } });
      const again = await ingestCvResult(ingestInput(job, video.id, result));
      expect(again.ingested).toBe(false);
      expect(await rawDb.track.count({ where: { matchId } })).toBe(before);
      expect(await rawDb.track.count({ where: { playerId: minor.id } })).toBe(0);

      // Withdrawing the adult purges their tracks; the clips and events stay, unlinked.
      const adultTracks = await rawDb.track.count({ where: { playerId: adult.id } });
      const adultEvents = await rawDb.event.count({ where: { playerId: adult.id } });
      expect(adultEvents).toBeGreaterThan(0);
      await withdrawConsent(club.ctx, adult.id, { requestedBy: adult.name, method: "in_person" });
      const purged = await purgeUnattributablePlayerTracks(club.org.id, adult.id);
      expect(purged).toEqual({ tracks: adultTracks, events: adultEvents });
      expect(await rawDb.track.count({ where: { playerId: adult.id } })).toBe(0);
      expect(await rawDb.event.count({ where: { playerId: adult.id } })).toBe(0);
      expect(await rawDb.clip.count({ where: { matchId } })).toBe(clips);
      expect(await rawDb.event.count({ where: { matchId } })).toBe(result.events.length);
    });
  },
);
