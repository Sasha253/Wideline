import { describe, expect, it } from "vitest";
import { countsFrom, eventSnapshot } from "@/server/review/corrections";
import { eventTime, eventWho, sidesConfirmed, shortClaimId } from "@/lib/review-workspace";

// C11 (REVIEW09, Q-067): a correction snapshot holds the event's own fields
// and no player id; the claim's counts take every decision as reviewed but
// leave plain confirmations out of the corrections.

describe("eventSnapshot", () => {
  it("keeps the event's fields and drops anything else", () => {
    const row = {
      type: "shot",
      status: "pending_review",
      teamSide: "home",
      trackId: "t1",
      onTarget: true,
      timestampMs: 31_000,
      playerId: "p1",
      pitchX: 50,
    };
    expect(eventSnapshot(row)).toEqual({
      type: "shot",
      status: "pending_review",
      teamSide: "home",
      trackId: "t1",
      onTarget: true,
      timestampMs: 31_000,
    });
  });
});

describe("countsFrom", () => {
  it("counts distinct events and leaves confirmations out of corrections", () => {
    expect(
      countsFrom([
        { eventId: "a", kind: "confirmed" },
        { eventId: "a", kind: "rejected" },
        { eventId: "b", kind: "confirmed" },
        { eventId: "c", kind: "relinked" },
        { eventId: "d", kind: "added" },
      ]),
    ).toEqual({ eventsReviewed: 4, corrections: 3, added: 1 });
    expect(countsFrom([])).toEqual({ eventsReviewed: 0, corrections: 0, added: 0 });
  });
});

describe("workspace labels", () => {
  const entries = new Map([
    ["l1", { id: "l1", side: "home" as const, shirtNumber: 7, label: "Home #7" }],
  ]);
  const tracks = new Map([["t1", { id: "t1", index: 22, side: "home" as const, entryId: null }]]);

  it("names the entry, else the unlinked track, else the team", () => {
    expect(eventWho({ entryId: "l1", trackId: "t1", side: "home" }, entries, tracks)).toBe(
      "Home #7",
    );
    expect(eventWho({ entryId: null, trackId: "t1", side: "home" }, entries, tracks)).toBe(
      "Unlinked track 22",
    );
    expect(eventWho({ entryId: null, trackId: null, side: "away" }, entries, tracks)).toBe(
      "Away team",
    );
    expect(eventWho({ entryId: null, trackId: null, side: null }, entries, tracks)).toBe(
      "No player",
    );
  });

  it("shows match time with markers and video time without", () => {
    const markers = {
      kickoffMs: 60_000,
      halfTimeMs: null,
      secondHalfKickoffMs: null,
      fullTimeMs: null,
    };
    expect(eventTime(60_000 + 31 * 60_000 + 24_000, markers, 45)).toBe("31:24");
    expect(eventTime(90_000, { kickoffMs: null }, 45)).toBe("1:30");
    // Before kickoff: no match clock, so the video time.
    expect(eventTime(30_000, markers, 45)).toBe("0:30");
  });

  it("confirms the sides only with a clear shirt-number margin (Q-041)", () => {
    expect(sidesConfirmed(null)).toBe(false);
    expect(sidesConfirmed({ kept: 0, swapped: 0 })).toBe(false);
    expect(sidesConfirmed({ kept: 3, swapped: 2 })).toBe(false);
    expect(sidesConfirmed({ kept: 4, swapped: 1 })).toBe(true);
    expect(sidesConfirmed({ kept: 0, swapped: 2 })).toBe(true);
  });

  it("shortens the claim id for the watermark", () => {
    expect(shortClaimId("cmabcdef4f7k2q")).toBe("4F7K2Q");
  });
});
