import { afterAll, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db/raw";
import { releaseClaim } from "@/server/review/claims";
import { confirmEvent, correctEvent, rejectEvent } from "@/server/review/decisions";
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

// C11 (REVIEW03, REVIEW09, Q-064, Q-067): confirm, reject and edit change the
// event and write an EventCorrection with the previous and new values in the
// same transaction. A decision on an ended claim, or in a "Log in as"
// session, is refused and writes nothing.

const f = fixtures();

afterAll(async () => {
  await f.cleanup();
});

const code = (err: unknown) => (err instanceof ReviewError ? err.code : err);

describe("review decisions", { timeout: 60_000 }, () => {
  it("confirm and reject write the status and a correction each", async () => {
    const m = await workspaceMatch(f, "Decide");
    const e = await cvEvent(m);
    const { scout, scope } = await claimed(f, m, "decide");

    const confirmed = await confirmEvent(scout, scope, e.id);
    expect(confirmed.events[0]).toMatchObject({ id: e.id, status: "confirmed" });
    expect(confirmed.counts).toEqual({ eventsReviewed: 1, corrections: 0, added: 0 });

    const rejected = await rejectEvent(scout, scope, e.id);
    expect(rejected.events[0]?.status).toBe("rejected");
    expect(rejected.counts).toEqual({ eventsReviewed: 1, corrections: 1, added: 0 });

    const rows = await corrections(e.id);
    expect(rows.map((r) => r.kind)).toEqual(["confirmed", "rejected"]);
    expect(rows[0]).toMatchObject({
      claimId: scope.claim.id,
      correctedByUserId: scout.user.id,
      previousValue: expect.objectContaining({ status: "pending_review", type: "shot" }),
      newValue: expect.objectContaining({ status: "confirmed" }),
    });
    expect(rows[1]?.previousValue).toMatchObject({ status: "confirmed" });
    expect(rows[1]?.newValue).toMatchObject({ status: "rejected" });
    // The snapshots never carry a player id.
    expect(JSON.stringify(rows.map((r) => [r.previousValue, r.newValue]))).not.toContain(
      "playerId",
    );

    // The same decision again changes nothing and writes nothing.
    await rejectEvent(scout, scope, e.id);
    expect(await corrections(e.id)).toHaveLength(2);
  });

  it("edit changes type, on target and side, confirms, and records both values", async () => {
    const m = await workspaceMatch(f, "Edit");
    const e = await cvEvent(m, { type: "shot", side: "home" });
    const { scout, scope } = await claimed(f, m, "edit");
    const patch = await correctEvent(scout, scope, {
      eventId: e.id,
      type: "goal",
      onTarget: true,
      side: "away",
      entryId: null,
    });
    expect(patch.events[0]).toMatchObject({
      type: "goal",
      onTarget: null,
      side: "away",
      status: "confirmed",
      corrected: true,
    });
    const [row] = await corrections(e.id);
    expect(row).toMatchObject({
      kind: "edited",
      previousValue: expect.objectContaining({ type: "shot", teamSide: "home" }),
      newValue: expect.objectContaining({ type: "goal", teamSide: "away", status: "confirmed" }),
    });
  });

  it("edit with nothing changed just confirms", async () => {
    const m = await workspaceMatch(f, "Edit same");
    const e = await cvEvent(m, { type: "touch", side: "home" });
    const { scout, scope } = await claimed(f, m, "edit same");
    await correctEvent(scout, scope, {
      eventId: e.id,
      type: "touch",
      onTarget: null,
      side: "home",
      entryId: null,
    });
    expect((await corrections(e.id)).map((r) => r.kind)).toEqual(["confirmed"]);
  });

  it("a refused reassignment in an edit changes nothing at all", async () => {
    const m = await workspaceMatch(f, "Edit refused");
    const none = await sidePlayer(m, "home", 9, "none");
    const e = await cvEvent(m, { type: "shot", side: "home" });
    const { scout, scope } = await claimed(f, m, "edit refused");
    const err = await correctEvent(scout, scope, {
      eventId: e.id,
      type: "goal",
      onTarget: null,
      side: "home",
      entryId: none.entryId,
    }).catch((x: unknown) => x);
    expect(code(err)).toBe("not_attributable");
    const after = await rawDb.event.findUniqueOrThrow({ where: { id: e.id } });
    expect(after).toMatchObject({ type: "shot", status: "pending_review", playerId: null });
    expect(await corrections(e.id)).toHaveLength(0);
  });

  it("refuses an event of another match", async () => {
    const m = await workspaceMatch(f, "Mine");
    const other = await workspaceMatch(f, "Other");
    const theirs = await cvEvent(other);
    const { scout, scope } = await claimed(f, m, "other match");
    expect(code(await confirmEvent(scout, scope, theirs.id).catch((x: unknown) => x))).toBe(
      "not_found",
    );
    expect(await corrections(theirs.id)).toHaveLength(0);
  });

  it("refuses a decision after a release, an expiry or in a 'Log in as' session", async () => {
    const m = await workspaceMatch(f, "Ended");
    const e = await cvEvent(m);
    const t = await track(m);
    const { scout, claimId, scope } = await claimed(f, m, "ended");

    const impersonated = {
      ...scout,
      impersonator: { id: "admin", name: "Admin", email: "admin@test.local" },
    };
    expect(code(await confirmEvent(impersonated, scope, e.id).catch((x: unknown) => x))).toBe(
      "impersonation_refused",
    );

    // Past its end, before any sweep: the lock re-check refuses it.
    const later = new Date(scope.claim.expiresAt.getTime() + 1000);
    expect(
      code(await confirmEvent(scout, scope, e.id, { now: later }).catch((x: unknown) => x)),
    ).toBe("claim_ended");

    await releaseClaim(scout, claimId);
    expect(code(await rejectEvent(scout, scope, e.id).catch((x: unknown) => x))).toBe(
      "claim_ended",
    );
    expect(
      code(
        await correctEvent(scout, scope, {
          eventId: e.id,
          type: "goal",
          onTarget: null,
          side: "home",
          entryId: null,
        }).catch((x: unknown) => x),
      ),
    ).toBe("claim_ended");
    expect(await corrections(e.id)).toHaveLength(0);
    expect((await rawDb.event.findUniqueOrThrow({ where: { id: e.id } })).status).toBe(
      "pending_review",
    );
    expect(t.id).toBeTruthy();
  });
});
