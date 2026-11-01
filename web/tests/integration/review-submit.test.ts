import { afterAll, describe, expect, it } from "vitest";
import { QUEUES } from "@/server/queue";
import { rawDb } from "@/server/db/raw";
import { confirmEvent, correctEvent, rejectEvent } from "@/server/review/decisions";
import { ReviewError } from "@/server/review/errors";
import { claimScope } from "@/server/review/scope";
import { submitReview } from "@/server/review/submit";
import { fixtures } from "./helpers/fixtures";
import { jobsFor } from "./helpers/matches";
import { auditRows } from "./helpers/review";
import { claimed, cvEvent, workspaceMatch } from "./helpers/workspace";

// C11 (REVIEW08, REVIEW11, AUTH07, Q-066, Q-067): "Mark as reviewed" is
// refused while any pending_review event is left. On success the claim is
// submitted with its counts, the match is published with publishedAt, the
// review.claim_submitted audit row carries ids and counts only, a
// match-published job is queued for C12, and the claim gives no more access.

const f = fixtures();

afterAll(async () => {
  await f.cleanup();
});

const code = (err: unknown) => (err instanceof ReviewError ? err.code : err);

describe("submit a review", { timeout: 60_000 }, () => {
  it("is refused while events are left to check, with the count", async () => {
    const m = await workspaceMatch(f, "Submit pending");
    await cvEvent(m);
    await cvEvent(m);
    const { scout, scope } = await claimed(f, m, "submit pending");
    const err = await submitReview(scout, scope).catch((x: unknown) => x);
    expect(code(err)).toBe("events_pending");
    expect((err as ReviewError).limit).toBe(2);
    expect(
      (await rawDb.reviewClaim.findUniqueOrThrow({ where: { id: scope.claim.id } })).status,
    ).toBe("active");
    expect((await rawDb.match.findUniqueOrThrow({ where: { id: m.matchId } })).status).toBe(
      "in_review",
    );
  });

  it("submits the claim, publishes the match, audits and queues the job", async () => {
    const m = await workspaceMatch(f, "Submit");
    const a = await cvEvent(m);
    const b = await cvEvent(m);
    const c = await cvEvent(m, { status: "auto_accepted", confidence: 0.95 });
    const { scout, claimId, scope } = await claimed(f, m, "submit");
    await confirmEvent(scout, scope, a.id);
    await rejectEvent(scout, scope, b.id);
    await correctEvent(scout, scope, {
      eventId: c.id,
      type: "goal",
      onTarget: null,
      side: "home",
      entryId: null,
    });
    const now = new Date();
    const counts = await submitReview(scout, scope, { now });
    expect(counts).toEqual({ eventsReviewed: 3, corrections: 2, added: 0 });

    expect(await rawDb.reviewClaim.findUniqueOrThrow({ where: { id: claimId } })).toMatchObject({
      status: "submitted",
      submittedAt: now,
      endedAt: now,
      eventsReviewed: 3,
      corrections: 2,
    });
    expect(await rawDb.match.findUniqueOrThrow({ where: { id: m.matchId } })).toMatchObject({
      status: "published",
      publishedAt: now,
    });
    const [row] = await auditRows(claimId, "review.claim_submitted");
    expect(row).toMatchObject({ actorUserId: scout.user.id, organisationId: m.organisationId });
    expect(row?.metadata).toEqual({
      matchId: m.matchId,
      eventsReviewed: 3,
      corrections: 2,
      added: 0,
    });
    expect(await jobsFor(QUEUES.matchPublished, "claimId", claimId)).toBe(1);

    // Access ends with the submit (REVIEW11).
    expect(await claimScope(scout, claimId)).toBeNull();
    expect(code(await confirmEvent(scout, scope, a.id).catch((x: unknown) => x))).toBe(
      "claim_ended",
    );
    expect(code(await submitReview(scout, scope).catch((x: unknown) => x))).toBe("claim_ended");
  });

  it("is refused in a 'Log in as' session", async () => {
    const m = await workspaceMatch(f, "Submit impersonated");
    const { scout, scope } = await claimed(f, m, "submit impersonated");
    const as = { ...scout, impersonator: { id: "admin", name: "Admin", email: "a@test.local" } };
    expect(code(await submitReview(as, scope).catch((x: unknown) => x))).toBe(
      "impersonation_refused",
    );
    expect((await rawDb.match.findUniqueOrThrow({ where: { id: m.matchId } })).status).toBe(
      "in_review",
    );
  });
});
