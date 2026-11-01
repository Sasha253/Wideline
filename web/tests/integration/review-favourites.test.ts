import { afterAll, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db/raw";
import { releaseClaim } from "@/server/review/claims";
import { ReviewError } from "@/server/review/errors";
import { favouriteReviewClip, unfavouriteReviewClip } from "@/server/review/favourites";
import { fixtures } from "./helpers/fixtures";
import { claimed, cvEvent, workspaceMatch, type WorkspaceMatch } from "./helpers/workspace";

// C11 (PROF08, CV11, BILL01): the scout favourites a clip of the claimed
// match; the ClipFavourite row is written and the trigger clears the clip's
// expiry. Refused at the clip organisation's favourited_clips cap (an
// entitlement override), for another match's clip, and once the claim ends.

const f = fixtures();

afterAll(async () => {
  await f.cleanup();
});

const code = (err: unknown) => (err instanceof ReviewError ? err.code : err);

async function clipFor(m: WorkspaceMatch) {
  const e = await cvEvent(m);
  const base = new Date(Date.now() + 14 * 24 * 3600_000);
  return rawDb.clip.create({
    data: {
      organisationId: m.organisationId,
      matchId: m.matchId,
      eventId: e.id,
      blobPath: `orgs/${m.organisationId}/matches/${m.matchId}/clips/${e.id}.mp4`,
      startMs: e.clipStartMs ?? 0,
      endMs: e.clipEndMs ?? 10_000,
      sizeBytes: BigInt(1000),
      width: 1280,
      height: 720,
      baseExpiresAt: base,
      expiresAt: base,
    },
  });
}

describe("favourite a clip from review", { timeout: 60_000 }, () => {
  it("favourites and unfavourites; the trigger keeps the expiry", async () => {
    const m = await workspaceMatch(f, "Fav");
    const clip = await clipFor(m);
    const { scout, scope } = await claimed(f, m, "fav");
    await favouriteReviewClip(scout, scope, clip.id);
    expect(
      await rawDb.clipFavourite.count({ where: { clipId: clip.id, userId: scout.user.id } }),
    ).toBe(1);
    expect((await rawDb.clip.findUniqueOrThrow({ where: { id: clip.id } })).expiresAt).toBeNull();
    await unfavouriteReviewClip(scout, scope, clip.id);
    expect((await rawDb.clip.findUniqueOrThrow({ where: { id: clip.id } })).expiresAt).toEqual(
      clip.baseExpiresAt,
    );
  });

  it("is refused at the favourited_clips cap", async () => {
    const m = await workspaceMatch(f, "Fav cap");
    const clip = await clipFor(m);
    await rawDb.entitlement.create({
      data: {
        organisationId: m.organisationId,
        key: "favourited_clips",
        value: 0,
        source: "override",
        reason: "Test cap",
      },
    });
    const { scout, scope } = await claimed(f, m, "fav cap");
    expect(code(await favouriteReviewClip(scout, scope, clip.id).catch((x: unknown) => x))).toBe(
      "favourite_cap",
    );
    expect(await rawDb.clipFavourite.count({ where: { clipId: clip.id } })).toBe(0);
  });

  it("is refused for another match's clip and after the claim ends", async () => {
    const m = await workspaceMatch(f, "Fav ended");
    const other = await workspaceMatch(f, "Fav other");
    const clip = await clipFor(m);
    const theirs = await clipFor(other);
    const { scout, claimId, scope } = await claimed(f, m, "fav ended");
    expect(code(await favouriteReviewClip(scout, scope, theirs.id).catch((x: unknown) => x))).toBe(
      "not_found",
    );
    await releaseClaim(scout, claimId);
    expect(code(await favouriteReviewClip(scout, scope, clip.id).catch((x: unknown) => x))).toBe(
      "claim_ended",
    );
    expect(await rawDb.clipFavourite.count({ where: { clipId: clip.id } })).toBe(0);
  });
});
