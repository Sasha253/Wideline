import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLAIM_DECLARATION_VERSION, CLAIM_DURATION_MS } from "@/lib/review-rules";
import { rawDb } from "@/server/db/raw";
import { claimMatch, releaseClaim } from "@/server/review/claims";
import { ReviewError } from "@/server/review/errors";
import { prismaErrorCode } from "@/server/squad/errors";
import { fixtures } from "./helpers/fixtures";
import { affiliation, auditRows, lineupPlayer, reviewer, reviewMatch } from "./helpers/review";

// C10 acceptance (REVIEW01, REVIEW02, AUTH07, AUTH10): a claim moves the match to
// In review for 48 hours and is audited in the same transaction. A conflicted
// scout cannot claim, even when claimMatch() is called directly (the UI
// bypassed), and the refusal is audited with reason codes only.

const f = fixtures();
const DAY = 24 * 60 * 60 * 1000;

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (err) {
    if (err instanceof ReviewError) return err.code;
    throw err;
  }
};

afterAll(async () => {
  await f.cleanup();
});

describe("claimMatch", { timeout: 30_000 }, () => {
  it("claims for 48 hours, moves the match to In review and audits it in the same transaction", async () => {
    const scout = await reviewer(f, "happy");
    const m = await reviewMatch(f, "Claim FC");
    const before = Date.now();
    const { claimId } = await claimMatch(scout, m.matchId, { declaration: true });

    const claim = await rawDb.reviewClaim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claim).toMatchObject({
      organisationId: m.organisationId,
      matchId: m.matchId,
      videoId: m.videoId,
      scoutUserId: scout.user.id,
      status: "active",
      endedAt: null,
    });
    expect(claim.expiresAt.getTime() - claim.claimedAt.getTime()).toBe(CLAIM_DURATION_MS);
    expect(claim.claimedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    const match = await rawDb.match.findUniqueOrThrow({ where: { id: m.matchId } });
    expect(match.status).toBe("in_review");

    const [row] = await auditRows(claimId, "review.claim_started");
    expect(row).toMatchObject({
      organisationId: m.organisationId,
      actorUserId: scout.user.id,
      targetType: "ReviewClaim",
    });
    // Ids, the expiry and the declaration version only (NFR20).
    expect(row!.metadata).toEqual({
      matchId: m.matchId,
      videoId: m.videoId,
      expiresAt: claim.expiresAt.toISOString(),
      declaration: CLAIM_DECLARATION_VERSION,
    });
  });

  it("needs the declaration", async () => {
    const scout = await reviewer(f, "no-declaration");
    const m = await reviewMatch(f, "Declaration FC");
    expect(await codeOf(claimMatch(scout, m.matchId, { declaration: false }))).toBe(
      "declaration_required",
    );
    expect(await rawDb.reviewClaim.count({ where: { matchId: m.matchId } })).toBe(0);
  });

  it("refuses a second claim at the pilot limit of 1", async () => {
    const scout = await reviewer(f, "limit");
    const a = await reviewMatch(f, "Limit A FC");
    const b = await reviewMatch(f, "Limit B FC");
    await claimMatch(scout, a.matchId, { declaration: true });
    let limit: number | undefined;
    try {
      await claimMatch(scout, b.matchId, { declaration: true });
    } catch (err) {
      expect(err).toBeInstanceOf(ReviewError);
      expect((err as ReviewError).code).toBe("claim_limit");
      limit = (err as ReviewError).limit;
    }
    expect(limit).toBe(1);
    const [refused] = await auditRows(b.matchId, "review.claim_refused");
    expect(refused!.metadata).toEqual({ matchId: b.matchId, reason: "claim_limit", reasons: [] });
    expect((await rawDb.match.findUniqueOrThrow({ where: { id: b.matchId } })).status).toBe(
      "awaiting_review",
    );
  });

  it("lets exactly one of two scouts claiming at once win", async () => {
    const one = await reviewer(f, "race one");
    const two = await reviewer(f, "race two");
    const m = await reviewMatch(f, "Race FC");
    const codes = await Promise.all([
      codeOf(claimMatch(one, m.matchId, { declaration: true })),
      codeOf(claimMatch(two, m.matchId, { declaration: true })),
    ]);
    expect(codes.sort()).toEqual(["already_claimed", "ok"]);
    expect(await rawDb.reviewClaim.count({ where: { matchId: m.matchId, status: "active" } })).toBe(
      1,
    );
  });

  it("holds one active claim per match at the database (partial unique index)", async () => {
    const scout = await reviewer(f, "unique");
    const m = await reviewMatch(f, "Unique FC");
    await claimMatch(scout, m.matchId, { declaration: true });
    const now = new Date();
    const err = await rawDb.reviewClaim
      .create({
        data: {
          organisationId: m.organisationId,
          matchId: m.matchId,
          videoId: m.videoId,
          scoutUserId: scout.user.id,
          claimedAt: now,
          expiresAt: new Date(now.getTime() + CLAIM_DURATION_MS),
        },
      })
      .catch((e: unknown) => e);
    expect(prismaErrorCode(err)).toBe("P2002");
  });

  it.each([
    ["a draft match", { status: "draft" as const }],
    ["a processing match", { status: "processing" as const }],
    ["a published match", { status: "published" as const }],
    ["a suspended club", { orgStatus: "suspended" as const }],
    ["the Lab", { orgType: "platform" as const }],
    ["a scout network", { orgType: "scout_network" as const }],
    ["an agency", { orgType: "agency" as const }],
    ["footage past the clips window", { expiresInMs: -8 * DAY, deleted: true }],
  ])("refuses %s as not_available", async (label, opts) => {
    const scout = await reviewer(f, `na ${label}`);
    const m = await reviewMatch(f, `NA ${label}`, opts);
    expect(await codeOf(claimMatch(scout, m.matchId, { declaration: true }))).toBe("not_available");
    expect(await rawDb.reviewClaim.count({ where: { matchId: m.matchId } })).toBe(0);
  });

  it("refuses an unknown match as not_available", async () => {
    const scout = await reviewer(f, "unknown");
    expect(await codeOf(claimMatch(scout, "no-such-match", { declaration: true }))).toBe(
      "not_available",
    );
  });

  it("allows a clips-only match (raw footage deleted, clips kept)", async () => {
    const scout = await reviewer(f, "clips");
    const m = await reviewMatch(f, "Clips FC", { expiresInMs: -DAY, deleted: true });
    expect(await codeOf(claimMatch(scout, m.matchId, { declaration: true }))).toBe("ok");
  });
});

describe("conflicts (REVIEW02, AUTH10): refused on the server", { timeout: 30_000 }, () => {
  let m: Awaited<ReturnType<typeof reviewMatch>>;
  let orgName: string;

  beforeAll(async () => {
    m = await reviewMatch(f, "Hilton College", {
      homeName: "Hilton College U15",
      awayName: "Ajax Cape Town U15 Boys",
    });
    orgName = (await rawDb.organisation.findUniqueOrThrow({ where: { id: m.organisationId } }))
      .name;
    await lineupPlayer(m, "Sipho", "Dlamini");
  });

  async function expectConflict(
    label: string,
    declare: (userId: string) => Promise<unknown>,
    reasons: string[],
  ) {
    const scout = await reviewer(f, `conflict ${label}`);
    await declare(scout.user.id);
    expect(await codeOf(claimMatch(scout, m.matchId, { declaration: true }))).toBe("conflict");
    expect(await rawDb.reviewClaim.count({ where: { matchId: m.matchId } })).toBe(0);
    const rows = await rawDb.auditLog.findMany({
      where: { targetId: m.matchId, action: "review.claim_refused", actorUserId: scout.user.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toEqual({ matchId: m.matchId, reason: "conflict", reasons });
    // Reason codes only: no club, team or player name in the audit row.
    expect(JSON.stringify(rows[0]!.metadata)).not.toMatch(/hilton|ajax|sipho|dlamini/i);
  }

  it("a linked affiliation", async () => {
    await expectConflict(
      "linked",
      (u) => affiliation(u, { type: "club", name: "Old name", organisationId: m.organisationId }),
      ["organisation"],
    );
  });

  it("an unlinked affiliation with the club's name", async () => {
    // The organisation name also matches the home team name as whole words.
    await expectConflict("same name", (u) => affiliation(u, { type: "club", name: orgName }), [
      "organisation",
    ]);
  });

  it("a declared club name inside the opposition team name", async () => {
    await expectConflict(
      "team name",
      (u) => affiliation(u, { type: "club", name: "Ajax Cape Town" }),
      ["team_name"],
    );
  });

  it("a represented player in the lineup", async () => {
    await expectConflict(
      "player",
      (u) => affiliation(u, { type: "player", name: "sipho dlamini", clubName: "Elsewhere" }),
      ["player"],
    );
  });

  it("an affiliation removed 30 days ago (Q-006)", async () => {
    await expectConflict(
      "removed",
      (u) =>
        affiliation(u, {
          type: "club",
          name: "Ajax Cape Town",
          removedAt: new Date(Date.now() - 30 * DAY),
        }),
      ["team_name"],
    );
  });

  it("an accepted membership of the club", async () => {
    await expectConflict("member", (u) => f.member(m.organisationId, u, "coach"), ["organisation"]);
  });

  // REVIEW02 has no consent exception: a represented player blocks whether or
  // not the scout may see that player by name (Q-053).
  it("a represented player blocks whatever the lineup player's consent (Q-053)", async () => {
    for (const consent of ["scout_visible", "club_only", "none"] as const) {
      const match = await reviewMatch(f, `Consent ${consent} FC`);
      await lineupPlayer(match, "Jane", `Doe${consent}`, 4, consent);
      const scout = await reviewer(f, `represents ${consent}`);
      await affiliation(scout.user.id, { type: "player", name: `jane doe${consent}` });
      expect(await codeOf(claimMatch(scout, match.matchId, { declaration: true }))).toBe(
        "conflict",
      );
      expect(await rawDb.reviewClaim.count({ where: { matchId: match.matchId } })).toBe(0);
      const refused = await auditRows(match.matchId, "review.claim_refused");
      expect(refused).toHaveLength(1);
      expect(refused[0]!.metadata).toEqual({
        matchId: match.matchId,
        reason: "conflict",
        reasons: ["player"],
      });
      expect(JSON.stringify(refused[0]!.metadata)).not.toMatch(/jane|doe/i);
    }
  });

  it("does not block on an affiliation removed 91 days ago", async () => {
    const scout = await reviewer(f, "cooled off");
    await affiliation(scout.user.id, {
      type: "club",
      name: "Ajax Cape Town",
      removedAt: new Date(Date.now() - 91 * DAY),
    });
    const other = await reviewMatch(f, "Cooled FC", { awayName: "Ajax Cape Town U15" });
    expect(await codeOf(claimMatch(scout, other.matchId, { declaration: true }))).toBe("ok");
  });
});

// Q-064 (AUTH07, NFR20): a platform admin in a "Log in as" session may not
// claim or release as the scout: the declaration must be the scout's own, and
// the audit row would name the scout.
describe('"Log in as" sessions', { timeout: 30_000 }, () => {
  it("refuses a claim and a release, writing nothing", async () => {
    const scout = await reviewer(f, "impersonated");
    const admin = await f.user("Impersonating Admin");
    const asAdmin = {
      ...scout,
      impersonator: { id: admin.id, name: admin.name, email: admin.email },
    };
    const m = await reviewMatch(f, "Impersonated FC");
    expect(await codeOf(claimMatch(asAdmin, m.matchId, { declaration: true }))).toBe(
      "impersonation_refused",
    );
    expect(await rawDb.reviewClaim.count({ where: { matchId: m.matchId } })).toBe(0);
    expect(
      await rawDb.auditLog.count({ where: { targetId: m.matchId, actorUserId: scout.user.id } }),
    ).toBe(0);
    expect((await rawDb.match.findUniqueOrThrow({ where: { id: m.matchId } })).status).toBe(
      "awaiting_review",
    );

    // The scout's own claim, which the admin then cannot release.
    const { claimId } = await claimMatch(scout, m.matchId, { declaration: true });
    expect(await codeOf(releaseClaim(asAdmin, claimId))).toBe("impersonation_refused");
    expect((await rawDb.reviewClaim.findUniqueOrThrow({ where: { id: claimId } })).status).toBe(
      "active",
    );
    expect(await auditRows(claimId, "review.claim_released")).toHaveLength(0);
  });
});

describe("releaseClaim", { timeout: 30_000 }, () => {
  it("releases the owner's claim back to the queue and audits it", async () => {
    const scout = await reviewer(f, "release");
    const m = await reviewMatch(f, "Release FC");
    const { claimId } = await claimMatch(scout, m.matchId, { declaration: true });
    await releaseClaim(scout, claimId);

    const claim = await rawDb.reviewClaim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claim).toMatchObject({ status: "released", releaseReason: "scout" });
    expect(claim.endedAt).not.toBeNull();
    expect((await rawDb.match.findUniqueOrThrow({ where: { id: m.matchId } })).status).toBe(
      "awaiting_review",
    );
    const [row] = await auditRows(claimId, "review.claim_released");
    expect(row).toMatchObject({ actorUserId: scout.user.id, organisationId: m.organisationId });
    expect(row!.metadata).toEqual({ matchId: m.matchId, reason: "scout" });
  });

  it("is not_found for another scout's claim and claim_ended the second time", async () => {
    const owner = await reviewer(f, "owner");
    const other = await reviewer(f, "other");
    const m = await reviewMatch(f, "Owner FC");
    const { claimId } = await claimMatch(owner, m.matchId, { declaration: true });
    expect(await codeOf(releaseClaim(other, claimId))).toBe("not_found");
    expect((await rawDb.reviewClaim.findUniqueOrThrow({ where: { id: claimId } })).status).toBe(
      "active",
    );
    await releaseClaim(owner, claimId);
    expect(await codeOf(releaseClaim(owner, claimId))).toBe("claim_ended");
    expect(await auditRows(claimId, "review.claim_released")).toHaveLength(1);
  });

  it("lets the match be claimed again after a release", async () => {
    const scout = await reviewer(f, "again");
    const m = await reviewMatch(f, "Again FC");
    const first = await claimMatch(scout, m.matchId, { declaration: true });
    await releaseClaim(scout, first.claimId);
    const second = await claimMatch(scout, m.matchId, { declaration: true });
    expect(second.claimId).not.toBe(first.claimId);
  });
});
