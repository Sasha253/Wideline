import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLAIM_DURATION_MS } from "@/lib/review-rules";
import { rawDb } from "@/server/db/raw";
import { scopedDb, TenantScopeError } from "@/server/db/scoped";
import { claimMatch, ownClaim, releaseClaim } from "@/server/review/claims";
import { claimScope } from "@/server/review/scope";
import { prismaErrorCode } from "@/server/squad/errors";
import { fixtures } from "./helpers/fixtures";
import { lineupPlayer, reviewer, reviewMatch } from "./helpers/review";

// C10 (NFR16): ReviewClaim is a tenant table. Another organisation's scoped
// client cannot read a claim, the composite foreign keys refuse a claim whose
// match or video belongs to another organisation, and claimScope() hands out
// access only to the scout holding the live claim, and only to that claim:
// not to another match of the same club, nor to a club_only player's name.

const f = fixtures();
let a: Awaited<ReturnType<typeof reviewMatch>>;
let b: Awaited<ReturnType<typeof reviewMatch>>;
let claimA = "";
let scout: Awaited<ReturnType<typeof reviewer>>;

beforeAll(async () => {
  a = await reviewMatch(f, "Tenant A");
  b = await reviewMatch(f, "Tenant B");
  scout = await reviewer(f, "tenant");
  ({ claimId: claimA } = await claimMatch(scout, a.matchId, { declaration: true }));
});

afterAll(async () => {
  await f.cleanup();
});

describe("ReviewClaim tenant isolation", { timeout: 30_000 }, () => {
  it("org B's scoped client cannot read org A's claim; org A's can", async () => {
    const asB = scopedDb(b.organisationId);
    expect(await asB.reviewClaim.findFirst({ where: { id: claimA } })).toBeNull();
    expect(await asB.reviewClaim.count({ where: { matchId: a.matchId } })).toBe(0);
    const asA = scopedDb(a.organisationId);
    expect((await asA.reviewClaim.findFirst({ where: { id: claimA } }))?.id).toBe(claimA);
  });

  it("refuses a claim whose match or video is another organisation's (composite keys)", async () => {
    // A match of org A with no active claim, so only the foreign keys can refuse.
    const c = await reviewMatch(f, "Tenant C");
    const now = new Date();
    const base = {
      scoutUserId: scout.user.id,
      claimedAt: now,
      expiresAt: new Date(now.getTime() + CLAIM_DURATION_MS),
    };
    const wrongMatch = await rawDb.reviewClaim
      .create({
        data: { ...base, organisationId: b.organisationId, matchId: c.matchId, videoId: b.videoId },
      })
      .catch((e: unknown) => e);
    expect(prismaErrorCode(wrongMatch)).toBe("P2003");
    const wrongVideo = await rawDb.reviewClaim
      .create({
        data: { ...base, organisationId: b.organisationId, matchId: b.matchId, videoId: c.videoId },
      })
      .catch((e: unknown) => e);
    expect(prismaErrorCode(wrongVideo)).toBe("P2003");
  });

  it("claimScope() returns the scope only to the scout holding the live claim", async () => {
    const scope = await claimScope(scout, claimA);
    expect(scope?.claim).toMatchObject({
      id: claimA,
      organisationId: a.organisationId,
      matchId: a.matchId,
    });
    // The scope's client is the match's organisation's.
    expect(await scope!.db.match.findFirst({ where: { id: b.matchId } })).toBeNull();
    expect((await scope!.db.match.findFirst({ where: { id: a.matchId } }))?.id).toBe(a.matchId);

    const other = await reviewer(f, "tenant other");
    expect(await claimScope(other, claimA)).toBeNull();
    expect(await ownClaim(other, claimA)).toBeNull();
    // Expired by the clock, before any sweep.
    expect(
      await claimScope(scout, claimA, { now: new Date(Date.now() + CLAIM_DURATION_MS) }),
    ).toBeNull();
    expect(await claimScope(scout, "no-such-claim")).toBeNull();
  });

  it("claimScope() is null once the claim has ended", async () => {
    const m = await reviewMatch(f, "Tenant Ended");
    const s = await reviewer(f, "tenant ended");
    const { claimId } = await claimMatch(s, m.matchId, { declaration: true });
    await releaseClaim(s, claimId);
    expect(await claimScope(s, claimId)).toBeNull();
    expect((await ownClaim(s, claimId))?.status).toBe("released");
  });

  it("claimScope()'s client reaches only the claimed match and the names a reviewer may see", async () => {
    const one = await reviewMatch(f, "Scope One", { toCheck: 2 });
    // A second match of the same club.
    const two = await reviewMatch(f, "Scope Two", {
      organisationId: one.organisationId,
      awayName: "Scope Visitors U15",
      toCheck: 3,
    });
    const visible = await lineupPlayer(one, "Visible", "Onename", 7, "scout_visible");
    const clubOnly = await lineupPlayer(one, "Hidden", "Twoname", 8, "club_only");
    const elsewhere = await lineupPlayer(two, "Other", "Threename", 9, "scout_visible");
    const s = await reviewer(f, "tenant scope");
    const { claimId } = await claimMatch(s, one.matchId, { declaration: true });
    const scope = (await claimScope(s, claimId))!;
    const { db } = scope;

    expect((await db.match.findMany({ select: { id: true } })).map((r) => r.id)).toEqual([
      one.matchId,
    ]);
    expect(await db.match.findFirst({ where: { id: two.matchId } })).toBeNull();
    expect((await db.video.findMany({ select: { id: true } })).map((r) => r.id)).toEqual([
      one.videoId,
    ]);
    expect(await db.video.findFirst({ where: { id: two.videoId } })).toBeNull();
    expect(await db.event.count()).toBe(2);
    expect(await db.event.count({ where: { matchId: two.matchId } })).toBe(0);
    // Lineup rows give side and shirt number for everyone in the claimed match.
    const lineup = await db.lineup.findMany({ select: { playerId: true, shirtNumber: true } });
    expect(lineup.map((l) => l.playerId).sort()).toEqual([visible.id, clubOnly.id].sort());
    // Names only for scout_visible players of the claimed match (Q-021).
    const players = await db.player.findMany({ select: { id: true, firstName: true } });
    expect(players).toEqual([{ id: visible.id, firstName: "Visible" }]);
    expect(await db.player.findFirst({ where: { id: clubOnly.id } })).toBeNull();
    expect(await db.player.findFirst({ where: { id: elsewhere.id } })).toBeNull();

    // No walking from the claimed match to other rows, no probing by relation.
    const refused = async (p: Promise<unknown>) => {
      const err = await p.then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(TenantScopeError);
    };
    const loose = db as unknown as Record<
      string,
      Record<string, (a?: unknown) => Promise<unknown>>
    >;
    await refused(loose.match!.findFirst!({ include: { lineups: { include: { player: true } } } }));
    await refused(
      loose.match!.findFirst!({ select: { organisation: { select: { matches: true } } } }),
    );
    await refused(loose.event!.findMany!({ where: { player: { lastName: "Twoname" } } }));
    await refused(loose.lineup!.findMany!({ select: { player: true } }));
    await refused(
      loose.player!.findMany!({ where: { lineups: { some: { matchId: two.matchId } } } }),
    );
    await refused(loose.event!.findMany!({ orderBy: { match: { playedAt: "asc" } } }));
    // Reads only.
    await refused(loose.event!.create!({ data: { matchId: one.matchId, type: "goal" } }));
    await refused(loose.event!.updateMany!({ data: { status: "confirmed" } }));
    // Nothing else is on the object: no Consent, Team, ReviewClaim, raw SQL.
    for (const key of [
      "consent",
      "consentRequest",
      "team",
      "reviewClaim",
      "auditLog",
      "$queryRaw",
      // C11: the training rows and the CV job stay off the claim client.
      "eventCorrection",
      "processingJob",
    ]) {
      expect(loose[key]).toBeUndefined();
    }
    expect(await rawDb.event.count({ where: { matchId: one.matchId, status: "confirmed" } })).toBe(
      0,
    );
  });
});

describe("C11 review writes and EventCorrection tenant isolation", { timeout: 60_000 }, () => {
  it("scopes EventCorrection by organisation and refuses other organisations' ids", async () => {
    const { workspaceMatch, sidePlayer, track, cvEvent, claimed } =
      await import("./helpers/workspace");
    const { confirmEvent, reassignEvent } = await import("@/server/review/decisions");
    const { relinkTrack } = await import("@/server/review/tracks");
    const { favouriteReviewClip } = await import("@/server/review/favourites");
    const mine = await workspaceMatch(f, "Writes A");
    const theirs = await workspaceMatch(f, "Writes B");
    const e = await cvEvent(mine);
    const { scout: s, scope } = await claimed(f, mine, "writes a");
    await confirmEvent(s, scope, e.id);

    // The correction is org A's: org B's scoped client sees none of it.
    expect(await scopedDb(theirs.organisationId).eventCorrection.count()).toBe(0);
    expect(
      await scopedDb(theirs.organisationId).eventCorrection.count({ where: { eventId: e.id } }),
    ).toBe(0);
    expect(
      await scopedDb(mine.organisationId).eventCorrection.count({ where: { eventId: e.id } }),
    ).toBe(1);

    // Ids from org B, through org A's claim: refused, nothing written.
    const theirEvent = await cvEvent(theirs);
    const theirTrack = await track(theirs);
    const theirPlayer = await sidePlayer(theirs, "home", 7, "scout_visible");
    const theirClip = await rawDb.clip.create({
      data: {
        organisationId: theirs.organisationId,
        matchId: theirs.matchId,
        eventId: theirEvent.id,
        blobPath: `orgs/${theirs.organisationId}/matches/${theirs.matchId}/clips/x.mp4`,
        startMs: 0,
        endMs: 1000,
        sizeBytes: BigInt(1),
        width: 1,
        height: 1,
        baseExpiresAt: new Date(Date.now() + 86_400_000),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const fails = (p: Promise<unknown>) =>
      p.then(
        () => "ok",
        (err: { code?: string }) => err.code,
      );
    expect(await fails(confirmEvent(s, scope, theirEvent.id))).toBe("not_found");
    expect(await fails(relinkTrack(s, scope, { trackId: theirTrack.id, entryId: null }))).toBe(
      "not_found",
    );
    expect(
      await fails(reassignEvent(s, scope, { eventId: e.id, entryId: theirPlayer.entryId })),
    ).toBe("not_in_lineup");
    expect(await fails(favouriteReviewClip(s, scope, theirClip.id))).toBe("not_found");
    expect(
      await rawDb.eventCorrection.count({ where: { organisationId: theirs.organisationId } }),
    ).toBe(0);
  });
});
