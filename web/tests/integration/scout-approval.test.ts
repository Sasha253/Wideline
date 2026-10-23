import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError, type AuthContext } from "@/server/auth/session";
import { rawDb } from "@/server/db/raw";
import {
  approveScout,
  autoLinkAffiliations,
  countPendingScouts,
  countScoutsWithUnchecked,
  linkAffiliation,
  listLinkableOrganisations,
  listScouts,
  reinstateScout,
  rejectScout,
  suspendScout,
} from "@/server/platform/scouts";
import { scoutConflicts } from "@/server/scouts/conflicts";
import { fixtures } from "./helpers/fixtures";
import { scoutProfile } from "./helpers/scouts";

// C02 acceptance (AUTH08, ADMIN01, ADMIN06): a platform admin approves, rejects,
// suspends and reinstates scouts. Each decision is guarded on status, audited
// once with the actor, and emailed; a failed email never undoes the decision.

const sendMail = vi.hoisted(() => vi.fn());
vi.mock("@/server/mail", () => ({ sendMail }));

const f = fixtures();
let admin: AuthContext;
let clubOwner: AuthContext;

async function scout(
  label: string,
  opts: Parameters<typeof scoutProfile>[1] = {},
  verified = true,
) {
  const u = await f.user(`Scout ${label}`);
  if (!verified) await rawDb.user.update({ where: { id: u.id }, data: { emailVerified: false } });
  const p = await scoutProfile(u.id, opts);
  return { user: u, profile: p };
}

async function auditsFor(targetId: string, action: string) {
  return rawDb.auditLog.findMany({ where: { targetId, action } });
}

beforeAll(async () => {
  const platform = await f.org("Platform", { type: "platform" });
  const a = await f.user("Platform Admin");
  await f.member(platform.id, a.id, "platform_admin");
  admin = await f.ctx(a, platform.id);
  const club = await f.org("Club");
  const owner = await f.user("Club Owner");
  await f.member(club.id, owner.id, "owner");
  clubOwner = await f.ctx(owner, club.id);
});

beforeEach(() => {
  sendMail.mockReset();
});

afterAll(async () => {
  await f.cleanup();
});

describe("decisions", () => {
  it("approves a pending scout with a confirmed email: one audit row, one email", async () => {
    const { user, profile } = await scout("approve");
    const res = await approveScout(admin, profile.id);
    expect(res).toEqual({ name: user.name, email: user.email, emailSent: true });
    const fresh = await rawDb.scoutProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(fresh).toMatchObject({ status: "approved", reviewedById: admin.user.id });
    expect(fresh.verifiedAt).toBeInstanceOf(Date);
    expect(fresh.reviewedAt).toBeInstanceOf(Date);
    const audits = await auditsFor(profile.id, "scout.approved");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorUserId: admin.user.id,
      organisationId: null,
      targetType: "ScoutProfile",
      metadata: { scoutUserId: user.id, emailSent: true },
    });
    expect(sendMail).toHaveBeenCalledWith(
      user.email,
      "You can now review matches on Wideline",
      expect.stringContaining("/review"),
    );
  });

  it("refuses to approve while the email is unconfirmed", async () => {
    const { profile } = await scout("unconfirmed", {}, false);
    await expect(approveScout(admin, profile.id)).rejects.toMatchObject({
      code: "email_unconfirmed",
    });
    expect((await rawDb.scoutProfile.findUniqueOrThrow({ where: { id: profile.id } })).status).toBe(
      "pending",
    );
    expect(await auditsFor(profile.id, "scout.approved")).toHaveLength(0);
  });

  it("gives one success and one not_pending for two concurrent approvals", async () => {
    const { profile } = await scout("race");
    const results = await Promise.allSettled([
      approveScout(admin, profile.id),
      approveScout(admin, profile.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason,
    ).toMatchObject({ code: "not_pending" });
    expect(await auditsFor(profile.id, "scout.approved")).toHaveLength(1);
  });

  it("rejects a pending scout with a reason, keeps the row, audits and emails it", async () => {
    const { user, profile } = await scout("reject");
    await rejectScout(admin, profile.id, "  Could not confirm your club role.  ");
    const fresh = await rawDb.scoutProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(fresh).toMatchObject({
      status: "rejected",
      rejectionReason: "Could not confirm your club role.",
      reviewedById: admin.user.id,
    });
    const audits = await auditsFor(profile.id, "scout.rejected");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorUserId: admin.user.id,
      metadata: { reason: "Could not confirm your club role.", emailSent: true },
    });
    expect(sendMail.mock.calls[0]![0]).toBe(user.email);
    expect(sendMail.mock.calls[0]![2]).toContain("Reason: Could not confirm your club role.");
  });

  it("refuses a rejection reason over 500 characters", async () => {
    const { profile } = await scout("long reason");
    await expect(rejectScout(admin, profile.id, "x".repeat(501))).rejects.toThrow();
    expect((await rawDb.scoutProfile.findUniqueOrThrow({ where: { id: profile.id } })).status).toBe(
      "pending",
    );
  });

  it("suspends an approved scout with a required reason, then reinstates them", async () => {
    const { profile } = await scout("suspend", { status: "approved" });
    await expect(suspendScout(admin, profile.id, "   ")).rejects.toThrow();
    await suspendScout(admin, profile.id, "Downloaded footage");
    let fresh = await rawDb.scoutProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(fresh).toMatchObject({ status: "suspended", suspensionReason: "Downloaded footage" });
    expect(fresh.suspendedAt).toBeInstanceOf(Date);
    const suspended = await auditsFor(profile.id, "scout.suspended");
    expect(suspended).toHaveLength(1);
    expect(suspended[0]).toMatchObject({
      actorUserId: admin.user.id,
      metadata: { reason: "Downloaded footage", emailSent: true },
    });

    await reinstateScout(admin, profile.id);
    fresh = await rawDb.scoutProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(fresh).toMatchObject({ status: "approved", suspendedAt: null, suspensionReason: null });
    const reinstated = await auditsFor(profile.id, "scout.reinstated");
    expect(reinstated).toHaveLength(1);
    expect(reinstated[0]!.actorUserId).toBe(admin.user.id);
  });

  it("reminds a reinstated scout on stale terms to accept the current ones", async () => {
    const { profile } = await scout("stale reinstated", {
      status: "suspended",
      termsVersion: "2025-old",
    });
    await reinstateScout(admin, profile.id);
    expect(sendMail.mock.calls[0]![2]).toContain("accept the current confidentiality terms");
  });

  it.each([
    [
      "approve a suspended scout",
      "suspended",
      (id: string) => approveScout(admin, id),
      "not_pending",
    ],
    ["reject an approved scout", "approved", (id: string) => rejectScout(admin, id), "not_pending"],
    [
      "suspend a pending scout",
      "pending",
      (id: string) => suspendScout(admin, id, "x"),
      "not_approved",
    ],
    [
      "reinstate an approved scout",
      "approved",
      (id: string) => reinstateScout(admin, id),
      "not_suspended",
    ],
  ] as const)("refuses to %s", async (_label, status, decide, code) => {
    const { profile } = await scout(`illegal ${status} ${code}`, { status });
    await expect(decide(profile.id)).rejects.toMatchObject({ code });
    expect((await rawDb.scoutProfile.findUniqueOrThrow({ where: { id: profile.id } })).status).toBe(
      status,
    );
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("keeps the decision and reports emailSent false when the email fails", async () => {
    const { profile } = await scout("mail fails");
    sendMail.mockRejectedValueOnce(new Error("SMTP down"));
    const res = await approveScout(admin, profile.id);
    expect(res.emailSent).toBe(false);
    expect((await rawDb.scoutProfile.findUniqueOrThrow({ where: { id: profile.id } })).status).toBe(
      "approved",
    );
    const audits = await auditsFor(profile.id, "scout.approved");
    expect(audits[0]!.metadata).toMatchObject({ emailSent: false });
  });
});

describe("lists and links", () => {
  it("lists pending scouts oldest first, without the hash, with possible matches", async () => {
    const club = await f.org("Linkable United");
    const { user, profile } = await scout("listed");
    await rawDb.scoutAffiliation.createMany({
      data: [
        { scoutUserId: user.id, type: "club", name: club.name.toUpperCase() },
        { scoutUserId: user.id, type: "player", name: "Thabo", clubName: club.name },
        { scoutUserId: user.id, type: "club", name: "Gone FC", removedAt: new Date() },
      ],
    });
    const rows = await listScouts(admin, { status: "pending" });
    const row = rows.find((r) => r.id === profile.id)!;
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain(profile.idNumberHash);
    expect(row).toMatchObject({ name: user.name, email: user.email, emailVerified: true });
    expect(row.affiliations).toHaveLength(2);
    for (const a of row.affiliations) expect(a.suggestion?.id).toBe(club.id);
    expect(await countPendingScouts(admin)).toBeGreaterThan(0);
    expect((await listLinkableOrganisations(admin)).some((o) => o.id === club.id)).toBe(true);
  });

  it("links and unlinks an affiliation, audited, and refuses removed rows and inactive organisations", async () => {
    const club = await f.org("Link Target");
    const pendingOrg = await f.org("Pending Org", { status: "pending" });
    const { user } = await scout("linker");
    const aff = await rawDb.scoutAffiliation.create({
      data: { scoutUserId: user.id, type: "club", name: "Link Target" },
    });
    expect(await linkAffiliation(admin, aff.id, club.id)).toEqual({
      name: "Link Target",
      organisationName: club.name,
    });
    let fresh = await rawDb.scoutAffiliation.findUniqueOrThrow({ where: { id: aff.id } });
    expect(fresh).toMatchObject({ organisationId: club.id, linkedById: admin.user.id });
    // Not matched: no organisation, but the row is checked, by whom and when.
    await linkAffiliation(admin, aff.id, null);
    fresh = await rawDb.scoutAffiliation.findUniqueOrThrow({ where: { id: aff.id } });
    expect(fresh).toMatchObject({ organisationId: null, linkedById: admin.user.id });
    expect(fresh.linkedAt).toBeInstanceOf(Date);
    const audits = await auditsFor(aff.id, "scout.affiliation_linked");
    expect(audits).toHaveLength(2);
    expect(audits.every((a) => a.actorUserId === admin.user.id)).toBe(true);

    await expect(linkAffiliation(admin, aff.id, pendingOrg.id)).rejects.toMatchObject({
      code: "org_inactive",
    });
    await rawDb.scoutAffiliation.update({ where: { id: aff.id }, data: { removedAt: new Date() } });
    await expect(linkAffiliation(admin, aff.id, club.id)).rejects.toMatchObject({
      code: "affiliation_removed",
    });
  });
});

describe("declared conflicts block without an admin", () => {
  it("approval links an exact name match, audited, and scoutConflicts includes it", async () => {
    const club = await f.org("Ajax Approve");
    const twin = await f.org("Twin Approve");
    const twinAcademy = await f.org("Twin Approve", { type: "academy" });
    const { user, profile } = await scout("auto link");
    await rawDb.scoutAffiliation.createMany({
      data: [
        { scoutUserId: user.id, type: "club", name: club.name.toLowerCase() },
        // Two organisations share the name: left for an admin, but both block.
        { scoutUserId: user.id, type: "player", name: "Thabo", clubName: twin.name },
        { scoutUserId: user.id, type: "club", name: "Unknown Approve FC" },
      ],
    });

    await approveScout(admin, profile.id);

    const rows = await rawDb.scoutAffiliation.findMany({
      where: { scoutUserId: user.id },
      orderBy: { type: "asc" },
    });
    const byName = new Map(rows.map((r) => [r.clubName ?? r.name, r]));
    const linked = byName.get(club.name.toLowerCase())!;
    expect(linked).toMatchObject({ organisationId: club.id, linkedById: admin.user.id });
    expect(byName.get(twin.name)).toMatchObject({ organisationId: null, linkedAt: null });
    expect(byName.get("Unknown Approve FC")).toMatchObject({
      organisationId: null,
      linkedAt: null,
    });
    const audits = await auditsFor(linked.id, "scout.affiliation_linked");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorUserId: admin.user.id,
      metadata: { scoutUserId: user.id, linkedOrganisationId: club.id, automatic: true },
    });

    const { organisationIds } = await scoutConflicts(user.id);
    expect(organisationIds).toEqual([club.id, twin.id, twinAcademy.id].sort());
    // Nothing left to link.
    expect(await autoLinkAffiliations(admin, user.id)).toBe(0);
  });

  it("a club added after approval blocks at once and shows as unchecked until an admin checks it", async () => {
    const club = await f.org("Later Club");
    const { user, profile } = await scout("added later", { status: "approved" });
    expect(
      (await listScouts(admin, { status: "approved", unchecked: true })).map((r) => r.id),
    ).not.toContain(profile.id);
    const before = await countScoutsWithUnchecked(admin, { status: "approved" });

    const aff = await rawDb.scoutAffiliation.create({
      data: { scoutUserId: user.id, type: "club", name: club.name },
    });
    expect((await scoutConflicts(user.id)).organisationIds).toEqual([club.id]);
    const unchecked = await listScouts(admin, { status: "approved", unchecked: true });
    const row = unchecked.find((r) => r.id === profile.id)!;
    expect(row.affiliations[0]).toMatchObject({ checked: false, suggestion: { id: club.id } });
    expect(await countScoutsWithUnchecked(admin, { status: "approved" })).toBe(before + 1);

    // Saved as Not matched: checked, off the filter, and still a conflict by name.
    await linkAffiliation(admin, aff.id, null);
    expect(
      (await listScouts(admin, { status: "approved", unchecked: true })).map((r) => r.id),
    ).not.toContain(profile.id);
    expect(await countScoutsWithUnchecked(admin, { status: "approved" })).toBe(before);
    const all = await listScouts(admin, { status: "approved" });
    expect(all.find((r) => r.id === profile.id)!.affiliations[0]).toMatchObject({ checked: true });
    expect((await scoutConflicts(user.id)).organisationIds).toEqual([club.id]);
  });
});

describe("platform admin only", () => {
  it.each([
    ["a club owner", () => clubOwner],
    // A platform_admin role outside the platform organisation grants nothing.
    [
      "platform_admin in a tenant",
      () => ({ ...clubOwner, roles: ["platform_admin"] }) as AuthContext,
    ],
  ])("refuses every export for %s", async (_label, ctxOf) => {
    const ctx = ctxOf();
    const { profile } = await scout(`guard ${_label}`);
    const calls = [
      () => listScouts(ctx, { status: "pending" }),
      () => countPendingScouts(ctx),
      () => countScoutsWithUnchecked(ctx, { status: "approved" }),
      () => listLinkableOrganisations(ctx),
      () => autoLinkAffiliations(ctx, profile.userId),
      () => approveScout(ctx, profile.id),
      () => rejectScout(ctx, profile.id),
      () => suspendScout(ctx, profile.id, "x"),
      () => reinstateScout(ctx, profile.id),
      () => linkAffiliation(ctx, "x", null),
    ];
    for (const call of calls) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AuthzError);
      expect(err).toMatchObject({ status: 403 });
    }
  });
});
