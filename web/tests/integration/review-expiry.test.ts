import { afterAll, describe, expect, it, vi } from "vitest";
import { CLAIM_DURATION_MS } from "@/lib/review-rules";
import { rawDb } from "@/server/db/raw";
import { claimMatch, ownClaim } from "@/server/review/claims";
import { queueMatch } from "@/server/review/queue";
import { claimScope } from "@/server/review/scope";
import { runReviewSweep } from "@/server/review/sweep";
import { fixtures } from "./helpers/fixtures";
import { auditRows, reviewer, reviewMatch } from "./helpers/review";

// C10 acceptance (REVIEW01, A-5): a claim is released at 48 hours, proved with a
// fake clock (`now`). Every check treats the claim as ended at exactly 48 hours
// (lazy expiry); the sweep tidies up, returns the match to the queue and audits
// it with no actor. The sweep is idempotent.

// The sweep also sends the REVIEW13 alert (review-alerts.test.ts). With a clock
// 48 hours ahead it would mark every video in the database alerted, so not here.
vi.mock("@/server/review/alerts", () => ({ alertExpiringReviews: vi.fn(async () => 0) }));

const f = fixtures();

afterAll(async () => {
  await f.cleanup();
});

async function claimed(label: string) {
  const scout = await reviewer(f, label);
  const claimedAt = new Date();
  // Footage well beyond the claim, so the match stays in the waiting section.
  const m = await reviewMatch(f, `Expiry ${label}`, {
    now: claimedAt,
    expiresInMs: 5 * 24 * 60 * 60 * 1000,
  });
  const { claimId } = await claimMatch(scout, m.matchId, { declaration: true, now: claimedAt });
  return { scout, m, claimId, claimedAt, end: claimedAt.getTime() + CLAIM_DURATION_MS };
}

describe("claim expiry (fake clock)", { timeout: 30_000 }, () => {
  it("keeps the claim at 48 h minus 1 ms and expires it at 48 h", async () => {
    const { scout, m, claimId, end } = await claimed("sweep");

    await runReviewSweep({ now: new Date(end - 1) });
    let claim = await rawDb.reviewClaim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claim.status).toBe("active");
    expect(await claimScope(scout, claimId, { now: new Date(end - 1) })).not.toBeNull();

    const at = new Date(end);
    // Lazy expiry: ended for every check before any sweep.
    expect(await claimScope(scout, claimId, { now: at })).toBeNull();
    expect((await ownClaim(scout, claimId, at))?.status).toBe("expired");

    await runReviewSweep({ now: at });
    claim = await rawDb.reviewClaim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claim.status).toBe("expired");
    expect(claim.endedAt?.getTime()).toBe(end);
    expect(claim.releaseReason).toBeNull();
    expect((await rawDb.match.findUniqueOrThrow({ where: { id: m.matchId } })).status).toBe(
      "awaiting_review",
    );
    const rows = await auditRows(claimId, "review.claim_expired");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: null, organisationId: m.organisationId });
    expect(rows[0]!.metadata).toEqual({ matchId: m.matchId, reason: "expired" });

    // A second run changes nothing more.
    await runReviewSweep({ now: new Date(end + 60_000) });
    expect(await auditRows(claimId, "review.claim_expired")).toHaveLength(1);
    expect(
      (await rawDb.reviewClaim.findUniqueOrThrow({ where: { id: claimId } })).endedAt?.getTime(),
    ).toBe(end);
  });

  it("lets a second scout claim at the 48-hour mark before any sweep", async () => {
    const { m, claimId, end } = await claimed("lazy");
    const second = await reviewer(f, "lazy second");
    const at = new Date(end);

    // The queue lists the match again, though it is still In review in the table.
    expect((await rawDb.match.findUniqueOrThrow({ where: { id: m.matchId } })).status).toBe(
      "in_review",
    );
    expect(await queueMatch(second, m.matchId, new Date(end - 1))).toBeNull();
    const listed = await queueMatch(second, m.matchId, at);
    expect(listed?.row.matchId).toBe(m.matchId);

    const { claimId: next } = await claimMatch(second, m.matchId, { declaration: true, now: at });
    const old = await rawDb.reviewClaim.findUniqueOrThrow({ where: { id: claimId } });
    expect(old.status).toBe("expired");
    expect(await auditRows(claimId, "review.claim_expired")).toHaveLength(1);
    const fresh = await rawDb.reviewClaim.findUniqueOrThrow({ where: { id: next } });
    expect(fresh).toMatchObject({ status: "active", scoutUserId: second.user.id });
    expect((await rawDb.match.findUniqueOrThrow({ where: { id: m.matchId } })).status).toBe(
      "in_review",
    );
  });
});
