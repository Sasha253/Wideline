import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { landmarkById } from "@/lib/homography";
import {
  CalibrationInputError,
  reusableCalibration,
  saveManualCalibration,
  venueKey,
} from "@/server/cv/calibration";
import { ingestCvResult } from "@/server/cv/ingest";
import { rawDb } from "@/server/db/raw";
import { ingestInput } from "./helpers/clips";
import { event, onLineup, playerWithConsent, result, runningCvJob, track } from "./helpers/cv";
import { fixtures } from "./helpers/fixtures";
import { match, setupClub } from "./helpers/matches";
import { acceptedVideo } from "./helpers/transcode";

// C09 (CV05, Q-042): manual calibrations are reused by venue and camera,
// fallbacks never; saving supersedes the venue's current one, re-projects the
// match's stored points and events (dropping what lands off the pitch),
// recomputes distance covered, and is audited with ids and counts only. The
// role check is the Lab action's (tests/unit/server-actions-guarded.test.ts).

vi.mock("@/server/consent/jobs", () => ({ enqueueConsentWithdrawn: vi.fn(async () => {}) }));

const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;

beforeAll(async () => {
  club = await setupClub(f, "Calibration FC");
});

afterAll(async () => {
  await f.cleanup();
});

const CAMERA = "1920x1080";
const VENUE = venueKey("Dobsonville Stadium");

/** Landmarks drawn by a camera where image = scale * pitch + shift. */
function points(scale: number, shiftX = 0) {
  const ids = [
    "corner_near_left",
    "corner_near_right",
    "corner_far_right",
    "corner_far_left",
    "centre_spot",
    "left_box_near_front",
  ];
  return ids.map((id) => {
    const [x, y] = landmarkById(id)!.pitch;
    return { landmark: id, x: x * scale + shiftX, y: y * scale };
  });
}

/** A match with an ingested result: one linked track and one event with a position. */
async function setup() {
  const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
  const { video } = await acceptedVideo(club.org.id, matchId, { durationSec: 120 });
  const p = await playerWithConsent(club.ctx, club.own.id, "club_only", 20);
  await onLineup(club.org.id, matchId, club.own.id, p.id, 7);
  const job = await runningCvJob(club.org.id, matchId, video.id);
  // The helper's result carries an identity homography: stored metres are the "pixels".
  await ingestCvResult(
    ingestInput(job, video.id, result(job, [track(0, "home", 7, 0.9, 6)], [event("shot", 0, 0.9)])),
  );
  return { matchId, videoId: video.id };
}

describe("pitch calibration", { timeout: 60_000 }, () => {
  it("reuses manual calibrations only, supersedes, re-projects and audits", async () => {
    const { matchId, videoId } = await setup();
    // The ingest stored a fallback for this video; it is never reused.
    expect(await reusableCalibration(rawDb, club.org.id, VENUE, CAMERA)).toBeNull();
    const before = await rawDb.trackPoint.findMany({
      where: { matchId },
      orderBy: { tMs: "asc" },
    });
    const distanceBefore = (await rawDb.track.findFirstOrThrow({ where: { matchId } })).distanceM!;

    // pitch = pixels / 10: every stored point and event shrinks tenfold.
    const first = await saveManualCalibration(club.ctx, {
      matchId,
      points: points(10),
      expectedCurrentId: null,
    });
    expect(first.errorM).toBe(0);
    expect(first).toMatchObject({ reprojected: true, pointsDropped: 0, eventsMoved: 1 });
    const after = await rawDb.trackPoint.findMany({ where: { matchId }, orderBy: { tMs: "asc" } });
    expect(after).toHaveLength(before.length);
    after.forEach((p, i) => {
      expect(p.x).toBeCloseTo(before[i]!.x / 10, 4);
      expect(p.y).toBeCloseTo(before[i]!.y / 10, 4);
    });
    const ev = await rawDb.event.findFirstOrThrow({ where: { matchId } });
    expect(ev.pitchX).toBeCloseTo(8, 6);
    expect(ev.pitchY).toBeCloseTo(3.4, 6);
    const distanceAfter = (await rawDb.track.findFirstOrThrow({ where: { matchId } })).distanceM!;
    expect(distanceAfter).toBeCloseTo(distanceBefore / 10, 3);
    expect(
      (await rawDb.video.findUniqueOrThrow({ where: { id: videoId } })).pitchCalibrationId,
    ).toBe(first.id);
    const reused = await reusableCalibration(rawDb, club.org.id, VENUE, CAMERA);
    expect(reused?.id).toBe(first.id);

    // Someone else saved since the page loaded.
    await expect(
      saveManualCalibration(club.ctx, { matchId, points: points(10), expectedCurrentId: null }),
    ).rejects.toMatchObject({ code: "changed" });

    // A second calibration supersedes the first; points now off the pitch go.
    const second = await saveManualCalibration(club.ctx, {
      matchId,
      points: points(1, 60),
      expectedCurrentId: first.id,
    });
    expect(second.pointsDropped).toBe(before.length);
    expect(await rawDb.trackPoint.count({ where: { matchId } })).toBe(0);
    // The event (8, 3.4) is at pixel (80, 34) under the first: (20, 34) under the second.
    const moved = await rawDb.event.findFirstOrThrow({ where: { matchId } });
    expect(moved.pitchX).toBeCloseTo(20, 4);
    expect(moved.pitchY).toBeCloseTo(34, 4);
    expect((await rawDb.track.findFirstOrThrow({ where: { matchId } })).distanceM).toBeNull();
    const old = await rawDb.pitchCalibration.findUniqueOrThrow({ where: { id: first.id } });
    expect(old.supersededAt).not.toBeNull();
    expect((await reusableCalibration(rawDb, club.org.id, VENUE, CAMERA))?.id).toBe(second.id);

    const audits = await rawDb.auditLog.findMany({
      where: { organisationId: club.org.id, action: "pitch_calibration.saved" },
    });
    expect(audits.map((a) => a.targetId)).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(JSON.stringify(audits.map((a) => a.metadata))).not.toMatch(/Thabo|Nkosi/);
  });

  it("refuses too few points, bad fields, a degenerate set and a large error", async () => {
    const { matchId } = await setup();
    const fail = async (pts: { landmark: string; x: number; y: number }[]) => {
      try {
        await saveManualCalibration(club.ctx, { matchId, points: pts, expectedCurrentId: null });
        return null;
      } catch (err) {
        expect(err).toBeInstanceOf(CalibrationInputError);
        return err as CalibrationInputError;
      }
    };
    expect((await fail(points(10).slice(0, 3)))?.code).toBe("too_few");
    const bad = points(10);
    bad[1] = { ...bad[1]!, landmark: bad[0]!.landmark };
    bad[2] = { ...bad[2]!, x: 5000 };
    const fields = await fail(bad);
    expect(fields?.code).toBe("fields");
    expect(fields?.fieldErrors).toMatchObject({
      "points.1.landmark": "Each landmark can be used once.",
      "points.2.x": "Enter a value from 0 to 1920.",
    });
    const off = points(10);
    off[4] = { ...off[4]!, x: off[4]!.x + 300 };
    const large = await fail(off);
    expect(large?.code).toBe("error_too_large");
    expect(large?.errorM).toBeGreaterThan(1.5);
  });
});
