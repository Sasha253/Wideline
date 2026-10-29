import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { favouriteClip, unfavouriteClip } from "@/server/clips/favourites";
import { ingestCvResult } from "@/server/cv/ingest";
import { rawDb } from "@/server/db/raw";
import { handleClips } from "@/worker/clips";
import { fakeCutter, ingestInput } from "./helpers/clips";
import { event, result, runningCvJob } from "./helpers/cv";
import { fixtures } from "./helpers/fixtures";
import { match, setupClub } from "./helpers/matches";
import { acceptedVideo } from "./helpers/transcode";

// C09 (CV11): the ClipFavourite triggers own Clip.expiresAt. Any favourite
// clears it, removing the last restores baseExpiresAt, a user deletion
// cascade restores it too, and a clip whose file is deleted cannot be
// favourited. A scout from another organisation favourites a clip under the
// clip's organisation.

vi.mock("@/server/mail-transport", () => ({ deliverMail: vi.fn(async () => {}) }));

const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;

beforeAll(async () => {
  club = await setupClub(f, "Favourites FC");
});

afterAll(async () => {
  await f.cleanup();
});

/** One clip of a fresh match. */
async function clip() {
  const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
  const { video } = await acceptedVideo(club.org.id, matchId, { durationSec: 120 });
  const job = await runningCvJob(club.org.id, matchId, video.id);
  const out = await ingestCvResult(
    ingestInput(job, video.id, result(job, [], [event("shot", null, 0.9, 30_000)])),
  );
  await handleClips(
    { organisationId: club.org.id, videoId: video.id, processingJobId: out.clipsJob!.id },
    { retryCount: 0, retryLimit: 2 },
    { cutter: fakeCutter().cutter },
  );
  return rawDb.clip.findFirstOrThrow({ where: { matchId } });
}

const expiresAt = async (id: string) =>
  (await rawDb.clip.findUniqueOrThrow({ where: { id } })).expiresAt;

const fav = (clipId: string, userId: string) =>
  rawDb.$transaction((tx) => favouriteClip(tx, { organisationId: club.org.id, clipId, userId }));
const unfav = (clipId: string, userId: string) =>
  rawDb.$transaction((tx) => unfavouriteClip(tx, { organisationId: club.org.id, clipId, userId }));

describe("clip favourites", () => {
  it("clears expiresAt while any favourite exists and restores it after the last", async () => {
    const c = await clip();
    expect(c.expiresAt?.getTime()).toBe(c.baseExpiresAt.getTime());
    expect(await fav(c.id, club.owner.id)).toBe(true);
    expect(await expiresAt(c.id)).toBeNull();
    expect(await fav(c.id, club.owner.id)).toBe(false); // already a favourite
    expect(await fav(c.id, club.coach.id)).toBe(true);
    expect(await unfav(c.id, club.owner.id)).toBe(true);
    expect(await expiresAt(c.id)).toBeNull();
    expect(await unfav(c.id, club.coach.id)).toBe(true);
    expect((await expiresAt(c.id))?.getTime()).toBe(c.baseExpiresAt.getTime());
    const audits = await rawDb.auditLog.findMany({
      where: { targetId: c.id, action: { in: ["clip.favourited", "clip.unfavourited"] } },
    });
    expect(audits).toHaveLength(4);
  });

  it("restores expiresAt when the favouriting user is deleted", async () => {
    const c = await clip();
    const temp = await f.user("Temp Reviewer");
    await fav(c.id, temp.id);
    expect(await expiresAt(c.id)).toBeNull();
    await rawDb.user.delete({ where: { id: temp.id } });
    expect((await expiresAt(c.id))?.getTime()).toBe(c.baseExpiresAt.getTime());
  });

  it("refuses a favourite on a clip whose file is deleted", async () => {
    const c = await clip();
    await rawDb.clip.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
    let message = "";
    try {
      await fav(c.id, club.owner.id);
    } catch (err) {
      message = String(err);
    }
    expect(message).toMatch(/deleted and cannot be favourited/);
    expect(await rawDb.clipFavourite.count({ where: { clipId: c.id } })).toBe(0);
  });

  it("takes a favourite from a scout of another organisation, under the clip's organisation", async () => {
    const c = await clip();
    const scoutOrg = await f.org("Scout Net", { type: "scout_network" });
    const scout = await f.user("Scout Sipho");
    await f.member(scoutOrg.id, scout.id, "scout");
    expect(await fav(c.id, scout.id)).toBe(true);
    const row = await rawDb.clipFavourite.findFirstOrThrow({ where: { clipId: c.id } });
    expect(row.organisationId).toBe(club.org.id);
    expect(await expiresAt(c.id)).toBeNull();
  });
});
