import { afterAll, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db/raw";
import { ReviewError } from "@/server/review/errors";
import { addMissedEvent } from "@/server/review/missed";
import { fixtures } from "./helpers/fixtures";
import { claimed, corrections, sidePlayer, workspaceMatch } from "./helpers/workspace";

// C11 (REVIEW05, REVIEW09, Q-065): a missed event can be added while the raw
// footage exists. It is manual, with no job, no confidence and a clip window
// of 5 s either side, and it writes an added correction. It is refused once
// the raw footage has expired or been deleted (a fake clock), and outside the
// video. A player whose events cannot be recorded leaves it with the team.

const f = fixtures();

afterAll(async () => {
  await f.cleanup();
});

const HOUR = 3600_000;
const code = (err: unknown) => (err instanceof ReviewError ? err.code : err);

describe("add a missed event", { timeout: 60_000 }, () => {
  it("adds a manual event at the timestamp, with an added correction", async () => {
    const m = await workspaceMatch(f, "Missed");
    const thabo = await sidePlayer(m, "home", 7, "scout_visible");
    const { scout, scope } = await claimed(f, m, "missed");
    const result = await addMissedEvent(scout, scope, {
      timestampMs: 2000,
      type: "shot",
      onTarget: true,
      side: "home",
      entryId: thabo.entryId,
    });
    expect(result.notAttributable).toBe(false);
    expect(result.added).toMatchObject({
      status: "manual",
      manual: true,
      type: "shot",
      onTarget: true,
      entryId: thabo.entryId,
      confidence: null,
      clipStartMs: 0,
      clipEndMs: 7000,
    });
    expect(result.counts).toEqual({ eventsReviewed: 1, corrections: 1, added: 1 });
    const row = await rawDb.event.findUniqueOrThrow({ where: { id: result.added!.id } });
    expect(row).toMatchObject({
      jobId: null,
      sourceKey: null,
      confidence: null,
      playerId: thabo.playerId,
      playerSource: "reviewer",
      trackId: null,
    });
    const [c] = await corrections(row.id);
    expect(c).toMatchObject({ kind: "added", previousValue: {}, newPlayerId: thabo.playerId });
  });

  it("keeps the event with the team when the player cannot be recorded", async () => {
    const m = await workspaceMatch(f, "Missed refused");
    const none = await sidePlayer(m, "home", 9, "none");
    const { scout, scope } = await claimed(f, m, "missed refused");
    const result = await addMissedEvent(scout, scope, {
      timestampMs: 60_000,
      type: "goal",
      onTarget: null,
      side: "home",
      entryId: none.entryId,
    });
    expect(result.notAttributable).toBe(true);
    const row = await rawDb.event.findUniqueOrThrow({ where: { id: result.added!.id } });
    expect(row).toMatchObject({ playerId: null, teamSide: "home", status: "manual" });
  });

  it("is refused outside the video, after the raw footage expires, and once it is deleted", async () => {
    const m = await workspaceMatch(f, "Missed gone", { expiresInMs: 2 * HOUR });
    const { scout, scope } = await claimed(f, m, "missed gone");
    const input = { type: "touch" as const, onTarget: null, side: "home" as const, entryId: null };

    const tooLate = await addMissedEvent(scout, scope, {
      ...input,
      timestampMs: 4200 * 1000 + 1,
    }).catch((x: unknown) => x);
    expect(code(tooLate)).toBe("out_of_range");

    // A fake clock past the raw expiry, with the claim still live.
    const expired = await addMissedEvent(
      scout,
      scope,
      { ...input, timestampMs: 1000 },
      { now: new Date(m.rawExpiresAt.getTime() + 1000) },
    ).catch((x: unknown) => x);
    expect(code(expired)).toBe("raw_footage_gone");

    await rawDb.video.update({ where: { id: m.videoId }, data: { deletedAt: new Date() } });
    const deleted = await addMissedEvent(scout, scope, { ...input, timestampMs: 1000 }).catch(
      (x: unknown) => x,
    );
    expect(code(deleted)).toBe("raw_footage_gone");
    expect(await rawDb.event.count({ where: { matchId: m.matchId } })).toBe(0);
  });
});
