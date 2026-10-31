import { afterAll, describe, expect, it } from "vitest";
import { MARKER_KEYS } from "@/lib/match-clock";
import { rawDb } from "@/server/db/raw";
import { lockMatchShared } from "@/server/db/locks";
import { MatchError } from "@/server/matches/errors";
import type { MarkersInput } from "@/server/matches/fields";
import { saveMarkers } from "@/server/matches/markers";
import { claimMatch } from "@/server/review/claims";
import { ReviewError } from "@/server/review/errors";
import { fixtures } from "./helpers/fixtures";
import { affiliation, grantConsent, reviewer, reviewMatch } from "./helpers/review";

// C10 (REVIEW02, A-6): a claim takes FOR UPDATE on the match before it reads the
// lineup; lineup and marker saves take FOR SHARE first. A save running
// alongside a claim either commits before the claim's conflict check (and is
// seen), or waits and then finds the match In review (locked). Lives here, not
// in lineups.test.ts, because it needs the review fixtures.

const f = fixtures();

afterAll(async () => {
  await f.cleanup();
});

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (err) {
    if (err instanceof ReviewError || err instanceof MatchError) return err.code;
    throw err;
  }
};

describe("lineup saves and claims", { timeout: 30_000 }, () => {
  it("a save holding the match lock is seen by a claim that runs alongside it", async () => {
    const scout = await reviewer(f, "lock seen");
    const m = await reviewMatch(f, "Lock Seen");
    await affiliation(scout.user.id, { type: "player", name: "Kagiso Rabada" });
    let claim: Promise<string> | null = null;

    // A lineup save, mid-transaction: FOR SHARE taken, the represented player
    // being added. The claim starts now and must wait for it.
    await rawDb.$transaction(async (tx) => {
      await lockMatchShared(tx, m.organisationId, m.matchId);
      const p = await tx.player.create({
        data: {
          organisationId: m.organisationId,
          teamId: m.home.id,
          firstName: "Kagiso",
          lastName: "Rabada",
        },
      });
      // Consent does not change the conflict (REVIEW02, Q-053); this mirrors a
      // lineup saved with consent in the same transaction.
      await grantConsent(m.organisationId, p.id, "scout_visible", tx);
      await tx.lineup.create({
        data: {
          organisationId: m.organisationId,
          matchId: m.matchId,
          teamId: m.home.id,
          playerId: p.id,
          shirtNumber: 25,
        },
      });
      claim = codeOf(claimMatch(scout, m.matchId, { declaration: true }));
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(await claim).toBe("conflict");
    expect(await rawDb.reviewClaim.count({ where: { matchId: m.matchId } })).toBe(0);
  });

  it("a save after the claim finds the match locked", async () => {
    const scout = await reviewer(f, "lock after");
    const m = await reviewMatch(f, "Lock After");
    const owner = await f.user("Lock After Owner");
    await f.member(m.organisationId, owner.id, "owner");
    const ctx = await f.ctx(owner, m.organisationId);
    await claimMatch(scout, m.matchId, { declaration: true });
    const markers = Object.fromEntries(MARKER_KEYS.map((k) => [k, null])) as MarkersInput;
    expect(await codeOf(saveMarkers(ctx, m.matchId, markers))).toBe("locked");
  });
});
