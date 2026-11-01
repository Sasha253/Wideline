import { afterAll, describe, expect, it, vi } from "vitest";
import { withdrawConsent } from "@/server/consent/records";
import { purgeUnattributablePlayerTracks } from "@/server/cv/withdrawal";
import { rawDb } from "@/server/db/raw";
import { confirmEvent, reassignEvent } from "@/server/review/decisions";
import { claimFacts, loadWorkspace } from "@/server/review/workspace";
import { fixtures } from "./helpers/fixtures";
import {
  claimed,
  corrections,
  cvEvent,
  sidePlayer,
  track,
  workspaceMatch,
} from "./helpers/workspace";

// C11 consent display (Q-021, CONS03) and the consent purge (NFR08, NFR11).
// loadWorkspace() names only scout_visible players ("#7 Thabo Nkosi"); every
// other lineup player is side and shirt number ("Home #8"), and no player id
// or other name reaches the payload. claimFacts() reports the thresholds, the
// unconfirmed sides and the claim's counts. Withdrawing a player's consent
// takes their id off the review training rows and off events a reviewer gave
// them on their own.

vi.mock("@/server/consent/jobs", () => ({ enqueueConsentWithdrawn: vi.fn(async () => {}) }));

const f = fixtures();

afterAll(async () => {
  await f.cleanup();
});

describe("loadWorkspace", { timeout: 60_000 }, () => {
  it("labels players per Q-021 and sends no player id or hidden name", async () => {
    const m = await workspaceMatch(f, "Labels");
    const visible = await sidePlayer(m, "home", 7, "scout_visible", {
      firstName: "Thabo",
      lastName: "Nkosi",
    });
    const clubOnly = await sidePlayer(m, "home", 8, "club_only", {
      firstName: "Hidden",
      lastName: "Childname",
    });
    const away = await sidePlayer(m, "away", 4, "none", { firstName: "Opp", lastName: "Name" });
    const t = await track(m, { side: "home", playerId: clubOnly.playerId });
    const e = await cvEvent(m, { trackId: t.id, playerId: clubOnly.playerId });
    const auto = await cvEvent(m, { status: "auto_accepted", confidence: 0.99 });
    const { scope, scout } = await claimed(f, m, "labels");

    const data = await loadWorkspace(scope);
    const labels = Object.fromEntries(data.entries.map((x) => [x.id, x.label]));
    expect(labels[visible.entryId]).toBe("#7 Thabo Nkosi");
    expect(labels[clubOnly.entryId]).toBe("Home #8");
    expect(labels[away.entryId]).toBe("Away #4");
    expect(data.tracks[0]).toMatchObject({ id: t.id, entryId: clubOnly.entryId, side: "home" });
    expect(data.events.find((x) => x.id === e.id)).toMatchObject({
      entryId: clubOnly.entryId,
      toCheck: true,
      manual: false,
    });
    expect(data.events.find((x) => x.id === auto.id)?.toCheck).toBe(false);

    const json = JSON.stringify(data);
    for (const hidden of ["Childname", "Hidden", "Opp", "consent", "scout_visible", "club_only"]) {
      expect(json).not.toContain(hidden);
    }
    for (const id of [visible.playerId, clubOnly.playerId, away.playerId]) {
      expect(json).not.toContain(id);
    }

    const facts = await claimFacts(scope, scout.user.id);
    expect(facts).toMatchObject({
      thresholds: { goal: 0.9, shot: 0.75, touch: 0.8 },
      sidesUnconfirmed: true,
      favouritedClipIds: [],
      counts: { eventsReviewed: 0, corrections: 0, added: 0 },
    });
  });

  it("reports confirmed sides when the shirt numbers settled them", async () => {
    const m = await workspaceMatch(f, "Facts", { evidence: { kept: 5, swapped: 1 } });
    const e = await cvEvent(m);
    const { scope, scout } = await claimed(f, m, "facts");
    await confirmEvent(scout, scope, e.id);
    const facts = await claimFacts(scope, scout.user.id);
    expect(facts.sidesUnconfirmed).toBe(false);
    expect(facts.counts).toEqual({ eventsReviewed: 1, corrections: 0, added: 0 });
  });
});

describe("consent withdrawal and review data (NFR08)", { timeout: 60_000 }, () => {
  it("reads a withdrawn player team-level at once, before the purge runs (CONS03, NFR11)", async () => {
    const m = await workspaceMatch(f, "Live withdraw");
    const p = await sidePlayer(m, "home", 9, "club_only");
    const t = await track(m, { side: "home", playerId: p.playerId });
    const e = await cvEvent(m, { trackId: t.id, playerId: p.playerId });
    const { scope, scout } = await claimed(f, m, "livewithdraw");

    const before = await loadWorkspace(scope);
    expect(before.events.find((x) => x.id === e.id)?.entryId).toBe(p.entryId);
    expect(before.tracks.find((x) => x.id === t.id)?.entryId).toBe(p.entryId);

    const staff = await f.user("Live withdraw staff");
    await f.member(m.organisationId, staff.id, "owner");
    const club = await f.ctx(staff, m.organisationId);
    await withdrawConsent(club, p.playerId, { requestedBy: "Thandi Mokoena", method: "in_person" });
    // No purge: the consent-withdrawn job is mocked and never runs here.
    expect(await rawDb.event.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({
      playerId: p.playerId,
    });

    const after = await loadWorkspace(scope);
    expect(after.events.find((x) => x.id === e.id)).toMatchObject({ entryId: null, side: "home" });
    expect(after.tracks.find((x) => x.id === t.id)).toMatchObject({ entryId: null, side: "home" });

    // A write's patch (buildPatch) re-checks consent too.
    const patch = await confirmEvent(scout, scope, e.id);
    expect(patch.events.find((x) => x.id === e.id)?.entryId).toBeNull();
  });

  it("nulls the player on correction rows and on events reassigned to them", async () => {
    const m = await workspaceMatch(f, "Withdraw");
    const p = await sidePlayer(m, "home", 6, "club_only");
    const e = await cvEvent(m, { side: "home" });
    const { scope, scout } = await claimed(f, m, "withdraw");
    await reassignEvent(scout, scope, { eventId: e.id, entryId: p.entryId });
    expect(await rawDb.event.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({
      playerId: p.playerId,
      playerSource: "reviewer",
    });

    const staff = await f.user("Withdraw staff");
    await f.member(m.organisationId, staff.id, "owner");
    const club = await f.ctx(staff, m.organisationId);
    await withdrawConsent(club, p.playerId, { requestedBy: "Thandi Mokoena", method: "in_person" });
    await purgeUnattributablePlayerTracks(m.organisationId, p.playerId);

    expect(await rawDb.event.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({
      playerId: null,
      playerSource: null,
      trackId: null,
    });
    const rows = await corrections(e.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      previousPlayerId: null,
      newPlayerId: null,
      kind: "reassigned",
    });
    expect(
      await rawDb.eventCorrection.count({
        where: { OR: [{ previousPlayerId: p.playerId }, { newPlayerId: p.playerId }] },
      }),
    ).toBe(0);
  });
});
