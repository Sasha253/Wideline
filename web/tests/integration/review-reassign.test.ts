import { afterAll, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db/raw";
import { reassignEvent } from "@/server/review/decisions";
import { ReviewError } from "@/server/review/errors";
import { fixtures } from "./helpers/fixtures";
import {
  claimed,
  corrections,
  cvEvent,
  sidePlayer,
  track,
  workspaceMatch,
} from "./helpers/workspace";

// C11 (REVIEW04, NFR08, Q-065): reassigning an event to an attributable lineup
// player moves it onto that player's linked track when there is one, and
// otherwise takes it off its track with playerSource reviewer (the relaxed
// Event_player_needs_track CHECK holds). A player with no consent, a
// placeholder, or a player outside the lineup is refused, and the event stays
// with the team.

const f = fixtures();

afterAll(async () => {
  await f.cleanup();
});

const code = (err: unknown) => (err instanceof ReviewError ? err.code : err);

describe("reassign an event", { timeout: 60_000 }, () => {
  it("moves the event onto the player's linked track", async () => {
    const m = await workspaceMatch(f, "Reassign track");
    const thabo = await sidePlayer(m, "home", 7, "scout_visible");
    const linked = await track(m, { side: "home", playerId: thabo.playerId });
    const unlinked = await track(m, { side: "home" });
    const e = await cvEvent(m, { trackId: unlinked.id });
    const { scout, scope } = await claimed(f, m, "reassign track");

    const patch = await reassignEvent(scout, scope, { eventId: e.id, entryId: thabo.entryId });
    expect(patch.events[0]).toMatchObject({
      trackId: linked.id,
      entryId: thabo.entryId,
      corrected: true,
    });
    const row = await rawDb.event.findUniqueOrThrow({ where: { id: e.id } });
    expect(row).toMatchObject({
      trackId: linked.id,
      playerId: thabo.playerId,
      playerSource: "track",
    });
    const [c] = await corrections(e.id);
    expect(c).toMatchObject({
      kind: "reassigned",
      previousPlayerId: null,
      newPlayerId: thabo.playerId,
      previousValue: expect.objectContaining({ trackId: unlinked.id }),
      newValue: expect.objectContaining({ trackId: linked.id }),
    });
  });

  it("detaches the event with playerSource reviewer when the player has no track", async () => {
    const m = await workspaceMatch(f, "Reassign free");
    const club = await sidePlayer(m, "home", 4, "club_only");
    const unlinked = await track(m, { side: "home" });
    const e = await cvEvent(m, { trackId: unlinked.id });
    const { scout, scope } = await claimed(f, m, "reassign free");

    await reassignEvent(scout, scope, { eventId: e.id, entryId: club.entryId });
    const row = await rawDb.event.findUniqueOrThrow({ where: { id: e.id } });
    expect(row).toMatchObject({ trackId: null, playerId: club.playerId, playerSource: "reviewer" });

    // Back to the team only.
    await reassignEvent(scout, scope, { eventId: e.id, entryId: null });
    expect(await rawDb.event.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({
      trackId: null,
      playerId: null,
      playerSource: null,
    });
    expect((await corrections(e.id)).map((r) => r.kind)).toEqual(["reassigned", "reassigned"]);
  });

  it("refuses a player with no consent or a placeholder, and keeps the event with the team", async () => {
    const m = await workspaceMatch(f, "Reassign refused");
    const none = await sidePlayer(m, "home", 11, "none");
    const placeholder = await sidePlayer(m, "away", 5, "none", { placeholder: true });
    const e = await cvEvent(m, { side: "home" });
    const away = await cvEvent(m, { side: "away" });
    const { scout, scope } = await claimed(f, m, "reassign refused");

    expect(
      code(
        await reassignEvent(scout, scope, { eventId: e.id, entryId: none.entryId }).catch(
          (x: unknown) => x,
        ),
      ),
    ).toBe("not_attributable");
    expect(
      code(
        await reassignEvent(scout, scope, { eventId: away.id, entryId: placeholder.entryId }).catch(
          (x: unknown) => x,
        ),
      ),
    ).toBe("not_attributable");
    for (const id of [e.id, away.id]) {
      expect(await rawDb.event.findUniqueOrThrow({ where: { id } })).toMatchObject({
        playerId: null,
        status: "pending_review",
      });
      expect(await corrections(id)).toHaveLength(0);
    }
  });

  it("refuses a player of the other side or from another match's lineup", async () => {
    const m = await workspaceMatch(f, "Reassign lineup");
    const other = await workspaceMatch(f, "Reassign elsewhere");
    // The away team is the opposition: no consent can be recorded for it.
    const awayPlayer = await sidePlayer(m, "away", 3, "none");
    const elsewhere = await sidePlayer(other, "home", 7, "scout_visible");
    const e = await cvEvent(m, { side: "home" });
    const { scout, scope } = await claimed(f, m, "reassign lineup");

    for (const entryId of [awayPlayer.entryId, elsewhere.entryId, "no-such-entry"]) {
      const err = await reassignEvent(scout, scope, { eventId: e.id, entryId }).catch(
        (x: unknown) => x,
      );
      expect(code(err)).toBe("not_in_lineup");
    }
    expect(await corrections(e.id)).toHaveLength(0);
  });
});
