import { afterAll, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db/raw";
import { reassignEvent } from "@/server/review/decisions";
import { ReviewError } from "@/server/review/errors";
import { relinkTrack, swapTeamSides } from "@/server/review/tracks";
import { fixtures } from "./helpers/fixtures";
import {
  claimed,
  corrections,
  cvEvent,
  sidePlayer,
  track,
  trackPoint,
  workspaceMatch,
} from "./helpers/workspace";

// C11 acceptance (REVIEW06, REVIEW09, Q-041, Q-065): relinking a track gives
// every event on it to the new player in one transaction, with one relinked
// correction per event. A refused link discards the track as ingest does: the
// track and its points go, and its events keep only their side. Unlinking
// takes the player away from every event on the track. Swapping home and
// away flips every track and event and drops links the new side's team does
// not hold; it is refused once the sides are confirmed.

const f = fixtures();

afterAll(async () => {
  await f.cleanup();
});

const code = (err: unknown) => (err instanceof ReviewError ? err.code : err);

describe("relink a track", { timeout: 60_000 }, () => {
  it("moves every event of the track to the new player, one correction each", async () => {
    const m = await workspaceMatch(f, "Relink");
    const a = await sidePlayer(m, "home", 7, "scout_visible");
    const b = await sidePlayer(m, "home", 8, "club_only");
    const t = await track(m, { side: "home", playerId: a.playerId });
    const events = await Promise.all(
      [1, 2, 3].map(() => cvEvent(m, { trackId: t.id, playerId: a.playerId })),
    );
    // An event the scout gave to player a on its own is not on the track.
    const own = await cvEvent(m, { side: "home" });
    const { scout, scope } = await claimed(f, m, "relink");
    await reassignEvent(scout, scope, { eventId: own.id, entryId: a.entryId });

    const result = await relinkTrack(scout, scope, { trackId: t.id, entryId: b.entryId });
    expect(result).toMatchObject({ discarded: false, moved: 4 });
    // own moved onto a's track when reassigned, so it moves with it.
    const rows = await rawDb.event.findMany({ where: { trackId: t.id } });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.playerId === b.playerId && r.playerSource === "track")).toBe(true);
    expect(await rawDb.track.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({
      playerId: b.playerId,
      linkedBy: "reviewer",
      linkedByUserId: scout.user.id,
      linkConfidence: null,
    });
    for (const e of events) {
      const kinds = await corrections(e.id);
      expect(kinds.map((c) => c.kind)).toEqual(["relinked"]);
      expect(kinds[0]).toMatchObject({ previousPlayerId: a.playerId, newPlayerId: b.playerId });
    }
    expect(result.tracks[0]).toMatchObject({ id: t.id, entryId: b.entryId });
  });

  it("keeps an event reassigned on its own (no track) when its old track is relinked", async () => {
    const m = await workspaceMatch(f, "Relink own");
    const a = await sidePlayer(m, "home", 7, "scout_visible");
    const b = await sidePlayer(m, "home", 8, "scout_visible");
    const t = await track(m, { side: "home" });
    const e = await cvEvent(m, { trackId: t.id });
    const { scout, scope } = await claimed(f, m, "relink own");
    await reassignEvent(scout, scope, { eventId: e.id, entryId: a.entryId });
    const result = await relinkTrack(scout, scope, { trackId: t.id, entryId: b.entryId });
    expect(result.moved).toBe(0);
    expect(await rawDb.event.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({
      playerId: a.playerId,
      playerSource: "reviewer",
      trackId: null,
    });
  });

  it("discards the track when the player's events cannot be recorded (Q-065)", async () => {
    const m = await workspaceMatch(f, "Relink refused");
    const none = await sidePlayer(m, "home", 10, "none");
    const t = await track(m, { side: "home" });
    await trackPoint(m, t.id);
    const e = await cvEvent(m, { trackId: t.id });
    const { scout, scope } = await claimed(f, m, "relink refused");

    const result = await relinkTrack(scout, scope, { trackId: t.id, entryId: none.entryId });
    expect(result).toMatchObject({ discarded: true, moved: 1, removedTrackIds: [t.id] });
    expect(await rawDb.track.findUnique({ where: { id: t.id } })).toBeNull();
    const points = await rawDb.trackPoint.count({ where: { trackId: t.id } });
    expect(points).toBe(0);
    expect(await rawDb.event.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({
      trackId: null,
      playerId: null,
      pitchX: null,
      pitchY: null,
      teamSide: "home",
    });
    const [c] = await corrections(e.id);
    expect(c).toMatchObject({ kind: "relinked", newPlayerId: null });
  });

  it("unlinks: every event of the track loses its player", async () => {
    const m = await workspaceMatch(f, "Unlink");
    const a = await sidePlayer(m, "home", 7, "scout_visible");
    const t = await track(m, { side: "home", playerId: a.playerId });
    const e = await cvEvent(m, { trackId: t.id, playerId: a.playerId });
    const { scout, scope } = await claimed(f, m, "unlink");
    const result = await relinkTrack(scout, scope, { trackId: t.id, entryId: null });
    expect(result.moved).toBe(1);
    expect(await rawDb.event.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({
      trackId: t.id,
      playerId: null,
      playerSource: null,
    });
    expect((await rawDb.track.findUniqueOrThrow({ where: { id: t.id } })).playerId).toBeNull();
  });

  it("refuses a player of the other side and a track of another match", async () => {
    const m = await workspaceMatch(f, "Relink side");
    const other = await workspaceMatch(f, "Relink other");
    const away = await sidePlayer(m, "away", 7, "none");
    const t = await track(m, { side: "home" });
    const theirs = await track(other, { side: "home" });
    const { scout, scope } = await claimed(f, m, "relink side");
    expect(
      code(
        await relinkTrack(scout, scope, { trackId: t.id, entryId: away.entryId }).catch(
          (x: unknown) => x,
        ),
      ),
    ).toBe("not_in_lineup");
    expect(
      code(
        await relinkTrack(scout, scope, { trackId: theirs.id, entryId: null }).catch(
          (x: unknown) => x,
        ),
      ),
    ).toBe("not_found");
  });
});

describe("swap home and away", { timeout: 60_000 }, () => {
  it("flips tracks and events, and drops links the new side does not hold", async () => {
    const m = await workspaceMatch(f, "Swap");
    const a = await sidePlayer(m, "home", 7, "scout_visible");
    const linked = await track(m, { side: "home", playerId: a.playerId });
    const plain = await track(m, { side: "away" });
    const e1 = await cvEvent(m, { side: "home", trackId: linked.id, playerId: a.playerId });
    const e2 = await cvEvent(m, { side: "away", trackId: plain.id });
    const e3 = await cvEvent(m, { side: null });
    const { scout, scope } = await claimed(f, m, "swap");

    const result = await swapTeamSides(scout, scope);
    expect(result.unlinked).toBe(1);
    expect(await rawDb.track.findUniqueOrThrow({ where: { id: linked.id } })).toMatchObject({
      teamSide: "away",
      playerId: null,
    });
    expect((await rawDb.track.findUniqueOrThrow({ where: { id: plain.id } })).teamSide).toBe(
      "home",
    );
    expect(await rawDb.event.findUniqueOrThrow({ where: { id: e1.id } })).toMatchObject({
      teamSide: "away",
      playerId: null,
    });
    expect((await rawDb.event.findUniqueOrThrow({ where: { id: e2.id } })).teamSide).toBe("home");
    expect((await rawDb.event.findUniqueOrThrow({ where: { id: e3.id } })).teamSide).toBeNull();
    expect((await corrections(e1.id)).map((c) => c.kind)).toEqual(["sides_swapped"]);
    expect(await corrections(e3.id)).toHaveLength(0);
  });

  it("is refused when the shirt numbers confirmed the sides", async () => {
    const m = await workspaceMatch(f, "Swap confirmed", { evidence: { kept: 6, swapped: 0 } });
    const e = await cvEvent(m, { side: "home" });
    const { scout, scope } = await claimed(f, m, "swap confirmed");
    expect(code(await swapTeamSides(scout, scope).catch((x: unknown) => x))).toBe(
      "sides_confirmed",
    );
    expect((await rawDb.event.findUniqueOrThrow({ where: { id: e.id } })).teamSide).toBe("home");
  });
});
