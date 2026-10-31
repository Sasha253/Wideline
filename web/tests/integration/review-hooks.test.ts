import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/server/auth/session";
import { rawDb } from "@/server/db/raw";
import { linkAffiliation, suspendScout } from "@/server/platform/scouts";
import { claimMatch } from "@/server/review/claims";
import { reviewQueue } from "@/server/review/queue";
import { runReviewSweep } from "@/server/review/sweep";
import { addOwnAffiliation, removeOwnAffiliation } from "@/server/scouts/profile";
import { fixtures } from "./helpers/fixtures";
import { affiliation, auditRows, reviewer, reviewMatch } from "./helpers/review";

// C10 (ADMIN06, A-9): a suspension releases the scout's claims in the suspend
// transaction; a new declared affiliation or an admin link that conflicts with
// a claimed match releases that claim (reason conflict); the sweep releases the
// claims of a scout with no profile, or one who gained a conflicting
// membership. Removing an affiliation releases nothing (Q-006).

const sendMail = vi.hoisted(() => vi.fn());
vi.mock("@/server/mail", () => ({ sendMail }));
vi.mock("@/server/review/alerts", () => ({ alertExpiringReviews: vi.fn(async () => 0) }));

const f = fixtures();
let admin: AuthContext;

beforeAll(async () => {
  const platform = await f.org("Hooks Platform", { type: "platform" });
  const a = await f.user("Hooks Admin");
  await f.member(platform.id, a.id, "platform_admin");
  admin = await f.ctx(a, platform.id);
});

afterAll(async () => {
  await f.cleanup();
});

async function claimed(label: string, opts: Parameters<typeof reviewMatch>[2] = {}) {
  const scout = await reviewer(f, label);
  const m = await reviewMatch(f, `Hooks ${label}`, opts);
  const { claimId } = await claimMatch(scout, m.matchId, { declaration: true });
  return { scout, m, claimId };
}

const claimOf = (id: string) => rawDb.reviewClaim.findUniqueOrThrow({ where: { id } });
const statusOf = async (matchId: string) =>
  (await rawDb.match.findUniqueOrThrow({ where: { id: matchId } })).status;

describe("claim release hooks", { timeout: 30_000 }, () => {
  it("suspendScout releases the scout's claims and puts the match back in the queue", async () => {
    const { scout, m, claimId } = await claimed("suspend");
    await suspendScout(admin, scout.scout.id, "Shared footage");
    expect(await claimOf(claimId)).toMatchObject({
      status: "released",
      releaseReason: "suspended",
    });
    expect(await statusOf(m.matchId)).toBe("awaiting_review");
    const [row] = await auditRows(claimId, "review.claim_released");
    expect(row).toMatchObject({ actorUserId: admin.user.id });
    expect(row!.metadata).toEqual({ matchId: m.matchId, reason: "suspended" });
    const other = await reviewer(f, "suspend other");
    const q = await reviewQueue(other);
    expect(q.waiting.some((r) => r.matchId === m.matchId)).toBe(true);
  });

  it("addOwnAffiliation naming the claimed match's club releases that claim", async () => {
    const { scout, m, claimId } = await claimed("declare", { awayName: "Kaizer Chiefs U15" });
    await addOwnAffiliation(scout.user.id, { type: "club", name: "Kaizer Chiefs" });
    expect(await claimOf(claimId)).toMatchObject({ status: "released", releaseReason: "conflict" });
    expect(await statusOf(m.matchId)).toBe("awaiting_review");
  });

  it("an unrelated new affiliation releases nothing; removing one releases nothing", async () => {
    const { scout, claimId } = await claimed("unrelated");
    const added = await addOwnAffiliation(scout.user.id, { type: "club", name: "Faraway United" });
    expect((await claimOf(claimId)).status).toBe("active");
    await removeOwnAffiliation(scout.user.id, added.id);
    expect((await claimOf(claimId)).status).toBe("active");
  });

  it("a platform link that creates a conflict releases the claim", async () => {
    const { scout, m, claimId } = await claimed("link");
    const a = await affiliation(scout.user.id, { type: "club", name: "Unmatched old name" });
    expect((await claimOf(claimId)).status).toBe("active");
    await linkAffiliation(admin, a.id, m.organisationId);
    expect(await claimOf(claimId)).toMatchObject({ status: "released", releaseReason: "conflict" });
  });

  it("the sweep releases the claims of a scout with no profile (reason no_profile)", async () => {
    const { scout, claimId } = await claimed("no profile");
    await rawDb.scoutProfile.delete({ where: { userId: scout.user.id } });
    await runReviewSweep();
    expect(await claimOf(claimId)).toMatchObject({
      status: "released",
      releaseReason: "no_profile",
    });
  });

  it("the sweep releases a claim once the scout gains a conflicting membership", async () => {
    const { scout, m, claimId } = await claimed("membership");
    await f.member(m.organisationId, scout.user.id, "coach");
    await runReviewSweep();
    expect(await claimOf(claimId)).toMatchObject({ status: "released", releaseReason: "conflict" });
    const [row] = await auditRows(claimId, "review.claim_released");
    expect(row!.actorUserId).toBeNull();
  });
});
