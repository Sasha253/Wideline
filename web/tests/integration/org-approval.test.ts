import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rawDb } from "@/server/db/raw";
import { acceptInvitation, findInvitationByToken } from "@/server/auth/invitations";
import { AuthzError, contextForSession, type AuthContext } from "@/server/auth/session";
import {
  approveOrganisation,
  listAllOrganisations,
  listOrganisationApplications,
  rejectOrganisation,
  resendOwnerInvitation,
  submitOrganisationApplication,
} from "@/server/platform/organisations";
import { newInvitationToken } from "@/server/organisations/tokens";
import { ensureScoutNetwork, SCOUT_NETWORK_ORG_ID } from "@/server/scouts/network";
import { fixtures } from "./helpers/fixtures";

// ADMIN01: organisations apply, start pending, and a platform admin approves
// or rejects them. Approval emails the applicant an owner invitation.

const sendMail = vi.hoisted(() => vi.fn());
vi.mock("@/server/mail", () => ({ sendMail }));

const f = fixtures();
let platformAdmin: AuthContext;
let clubOwner: AuthContext;

const apply = (local: string, extra: Record<string, string> = {}) =>
  submitOrganisationApplication({
    name: `Applicant ${local} ${f.tag}`,
    type: "academy",
    country: "za",
    region: "Gauteng",
    applicantName: "Thandi Mokoena",
    applicantEmail: `${local}-${f.tag}@test.local`,
    ...extra,
  });

beforeAll(async () => {
  const platform = await f.org("Platform", { type: "platform" });
  const admin = await f.user("Platform Admin");
  await f.member(platform.id, admin.id, "platform_admin");
  platformAdmin = await f.ctx(admin, platform.id);
  const club = await f.org("Some club");
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

describe("submitOrganisationApplication", () => {
  it("creates a pending organisation with no memberships, and audits it", async () => {
    const { id } = await apply("first");
    const org = await rawDb.organisation.findUniqueOrThrow({
      where: { id },
      include: { memberships: true },
    });
    expect(org).toMatchObject({
      status: "pending",
      type: "academy",
      country: "ZA",
      region: "Gauteng",
      applicantName: "Thandi Mokoena",
      applicantEmail: `first-${f.tag}@test.local`,
    });
    expect(org.memberships).toEqual([]);
    const log = await rawDb.auditLog.findFirst({
      where: { action: "organisation.applied", targetId: id },
    });
    expect(log?.actorUserId).toBeNull();
  });

  it("refuses a second pending application from the same email", async () => {
    await apply("dup");
    await expect(apply("dup")).rejects.toMatchObject({ code: "duplicate" });
  });

  it("refuses a filled honeypot and creates nothing", async () => {
    await expect(apply("bot", { website: "http://spam.example" })).rejects.toMatchObject({
      code: "spam",
    });
    expect(await rawDb.organisation.count({ where: { name: `Applicant bot ${f.tag}` } })).toBe(0);
  });

  it("refuses the platform type", async () => {
    await expect(apply("plat", { type: "platform" })).rejects.toThrow();
  });
});

describe("approval queue", () => {
  it("a pending organisation never becomes anyone's active organisation", async () => {
    const { id } = await apply("hidden");
    const u = await f.user("Hopeful");
    await f.member(id, u.id, "owner");
    const ctx = await contextForSession({ sessionId: "s", user: u, activeOrganisationId: id });
    expect(ctx.organisationId).toBeNull();
    expect(ctx.organisations).toEqual([]);
  });

  it("lists pending applications oldest first, for platform admins only", async () => {
    const { id } = await apply("listed");
    const rows = await listOrganisationApplications(platformAdmin, { status: "pending" });
    expect(rows.some((r) => r.id === id)).toBe(true);
    await expect(
      listOrganisationApplications(clubOwner, { status: "pending" }),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("approve activates the organisation and emails an owner invitation for 14 days", async () => {
    const { id } = await apply("approve");
    const before = Date.now();
    const res = await approveOrganisation(platformAdmin, id);
    expect(res.emailSent).toBe(true);

    const org = await rawDb.organisation.findUniqueOrThrow({ where: { id } });
    expect(org.status).toBe("active");
    expect(org.reviewedAt).not.toBeNull();

    const inv = await rawDb.invitation.findFirstOrThrow({ where: { organisationId: id } });
    expect(inv).toMatchObject({
      email: `approve-${f.tag}@test.local`,
      role: "owner",
      invitedById: platformAdmin.user.id,
    });
    const days = (inv.expiresAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(13.99);
    expect(days).toBeLessThan(14.01);

    const [to, subject, text] = sendMail.mock.calls[0]!;
    expect(to).toBe(`approve-${f.tag}@test.local`);
    expect(subject).toBe(`Applicant approve ${f.tag} is approved for the Wideline pilot`);
    const token = (text as string).match(/\/invite\/([\w-]+)/)![1]!;
    expect(await findInvitationByToken(token)).toMatchObject({ state: "pending", role: "owner" });

    const log = await rawDb.auditLog.findFirst({
      where: { action: "organisation.approved", targetId: id },
    });
    expect(log?.actorUserId).toBe(platformAdmin.user.id);
  });

  it("reject keeps the organisation with the reason, emails the applicant and audits", async () => {
    const { id } = await apply("reject");
    await rejectOrganisation(platformAdmin, id, "  Outside the pilot region.  ");
    const org = await rawDb.organisation.findUniqueOrThrow({ where: { id } });
    expect(org).toMatchObject({ status: "rejected", rejectionReason: "Outside the pilot region." });
    expect(org.reviewedAt).not.toBeNull();
    expect(sendMail.mock.calls[0]![2]).toContain("Reason: Outside the pilot region.");
    const log = await rawDb.auditLog.findFirst({
      where: { action: "organisation.rejected", targetId: id },
    });
    expect(log?.metadata).toMatchObject({ reason: "Outside the pilot region." });

    const decided = await listOrganisationApplications(platformAdmin, { status: "decided" });
    expect(decided.find((r) => r.id === id)?.status).toBe("rejected");
  });

  it("approving or rejecting an organisation that is not pending throws", async () => {
    const { id } = await apply("twice");
    await approveOrganisation(platformAdmin, id);
    await expect(approveOrganisation(platformAdmin, id)).rejects.toMatchObject({
      code: "not_pending",
    });
    await expect(rejectOrganisation(platformAdmin, id)).rejects.toMatchObject({
      code: "not_pending",
    });
  });

  it("only a platform admin can decide", async () => {
    const { id } = await apply("guarded");
    await expect(approveOrganisation(clubOwner, id)).rejects.toBeInstanceOf(AuthzError);
    await expect(rejectOrganisation(clubOwner, id)).rejects.toBeInstanceOf(AuthzError);
    expect((await rawDb.organisation.findUniqueOrThrow({ where: { id } })).status).toBe("pending");
  });
});

describe("resendOwnerInvitation", () => {
  /** The raw token from the newest mocked email. */
  const lastToken = () =>
    (sendMail.mock.calls.at(-1)![2] as string).match(/\/invite\/([\w-]+)/)![1]!;

  const decidedRow = async (id: string) =>
    (await listOrganisationApplications(platformAdmin, { status: "decided" })).find(
      (r) => r.id === id,
    );

  it("after a failed approval email, the admin resends and the applicant becomes owner", async () => {
    const { id } = await apply("mailfail");
    sendMail.mockRejectedValueOnce(new Error("SMTP down"));
    const approved = await approveOrganisation(platformAdmin, id);
    expect(approved.emailSent).toBe(false);
    const first = await rawDb.invitation.findFirstOrThrow({ where: { organisationId: id } });

    // The Decided tab flags it: active, no owner, an open owner invitation.
    expect((await decidedRow(id))?.ownerInvitation).toMatchObject({ status: "pending" });

    sendMail.mockClear();
    const before = Date.now();
    const res = await resendOwnerInvitation(platformAdmin, id);
    expect(res).toMatchObject({
      emailSent: true,
      applicantEmail: `mailfail-${f.tag}@test.local`,
    });
    const days = (res.expiresAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(13.99);
    expect(days).toBeLessThan(14.01);

    const [to, subject] = sendMail.mock.calls[0]!;
    expect(to).toBe(`mailfail-${f.tag}@test.local`);
    expect(subject).toBe(`Applicant mailfail ${f.tag} is approved for the Wideline pilot`);
    const token = lastToken();
    expect(await findInvitationByToken(token)).toMatchObject({
      state: "pending",
      role: "owner",
      fromPlatform: true,
    });

    const revoked = await rawDb.invitation.findUniqueOrThrow({ where: { id: first.id } });
    expect(revoked.revokedAt).not.toBeNull();
    const open = await rawDb.invitation.count({
      where: { organisationId: id, acceptedAt: null, revokedAt: null },
    });
    expect(open).toBe(1);

    const log = await rawDb.auditLog.findFirst({
      where: { action: "invitation.resent", organisationId: id },
    });
    expect(log?.actorUserId).toBe(platformAdmin.user.id);
    expect(log?.metadata).toMatchObject({ role: "owner", previousInvitationIds: [first.id] });

    const accepted = await acceptInvitation({
      token,
      newUser: { name: "Thandi Mokoena", password: "a-long-password" },
    });
    await f.trackUserByEmail(accepted.email);
    const owner = await rawDb.membership.findFirst({
      where: { organisationId: id, userId: accepted.userId, role: "owner" },
    });
    expect(owner).not.toBeNull();
    expect((await decidedRow(id))?.ownerInvitation).toBeNull();

    // With an owner, the organisation manages its own invitations.
    await expect(resendOwnerInvitation(platformAdmin, id)).rejects.toMatchObject({
      code: "has_owner",
    });
  });

  it("after the owner invitation expires, a resend gives a link that works", async () => {
    const { id } = await apply("expired");
    await approveOrganisation(platformAdmin, id);
    const oldToken = lastToken();
    await rawDb.invitation.updateMany({
      where: { organisationId: id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await findInvitationByToken(oldToken)).toMatchObject({
      state: "expired",
      fromPlatform: true,
    });
    expect((await decidedRow(id))?.ownerInvitation).toMatchObject({ status: "expired" });

    await resendOwnerInvitation(platformAdmin, id);
    const token = lastToken();
    expect(token).not.toBe(oldToken);
    expect(await findInvitationByToken(oldToken)).toMatchObject({ state: "revoked" });
    await expect(
      acceptInvitation({ token: oldToken, newUser: { name: "T", password: "a-long-password" } }),
    ).rejects.toMatchObject({ code: "revoked" });

    const accepted = await acceptInvitation({
      token,
      newUser: { name: "Thandi Mokoena", password: "a-long-password" },
    });
    await f.trackUserByEmail(accepted.email);
    expect(accepted.organisationId).toBe(id);
  });

  it("a failed resend email still leaves a new open invitation to resend again", async () => {
    const { id } = await apply("resendfail");
    await approveOrganisation(platformAdmin, id);
    sendMail.mockRejectedValueOnce(new Error("SMTP down"));
    const res = await resendOwnerInvitation(platformAdmin, id);
    expect(res.emailSent).toBe(false);
    expect((await decidedRow(id))?.ownerInvitation).toMatchObject({ status: "pending" });
    expect((await resendOwnerInvitation(platformAdmin, id)).emailSent).toBe(true);
  });

  it("refuses organisations that are not active, and non-platform callers", async () => {
    const pending = await apply("notyet");
    await expect(resendOwnerInvitation(platformAdmin, pending.id)).rejects.toMatchObject({
      code: "not_active",
    });
    const rejected = await apply("nope");
    await rejectOrganisation(platformAdmin, rejected.id);
    await expect(resendOwnerInvitation(platformAdmin, rejected.id)).rejects.toMatchObject({
      code: "not_active",
    });
    expect((await decidedRow(rejected.id))?.ownerInvitation).toBeNull();
    await expect(resendOwnerInvitation(platformAdmin, "missing")).rejects.toMatchObject({
      code: "not_found",
    });

    const approved = await apply("guardedresend");
    await approveOrganisation(platformAdmin, approved.id);
    await expect(resendOwnerInvitation(clubOwner, approved.id)).rejects.toBeInstanceOf(AuthzError);
  });

  it("an invitation from inside the organisation is not marked as from Wideline", async () => {
    const club = await f.org("Inviting club");
    const owner = await f.user("Inviting Owner");
    await f.member(club.id, owner.id, "owner");
    const { token, tokenHash } = newInvitationToken();
    await rawDb.invitation.create({
      data: {
        organisationId: club.id,
        email: `coach-${f.tag}@test.local`,
        role: "coach",
        tokenHash,
        invitedById: owner.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    expect(await findInvitationByToken(token)).toMatchObject({ fromPlatform: false });
  });
});

// C03 (BILL02): every organisation runs on the pilot plan.
describe("pilot subscriptions", () => {
  it("an application creates a pilot subscription with its organisation", async () => {
    const { id } = await apply("pilot-plan");
    const sub = await rawDb.subscription.findUniqueOrThrow({
      where: { organisationId: id },
      include: { plan: true },
    });
    expect(sub.status).toBe("active");
    expect(sub.provider).toBeNull();
    expect(sub.plan.code).toBe("pilot");
  });

  it("the scout network has exactly one subscription, however often it is ensured", async () => {
    await ensureScoutNetwork();
    await ensureScoutNetwork();
    expect(
      await rawDb.subscription.count({ where: { organisationId: SCOUT_NETWORK_ORG_ID } }),
    ).toBe(1);
  });

  it("listAllOrganisations lists every organisation with its plan, for platform admins only", async () => {
    await expect(listAllOrganisations(clubOwner)).rejects.toBeInstanceOf(AuthzError);
    const { id } = await apply("all-tab");
    const noPlan = await f.org("Zz no plan");
    const all = await listAllOrganisations(platformAdmin);
    expect(all.find((o) => o.id === id)).toMatchObject({ planName: "Pilot", status: "pending" });
    expect(all.find((o) => o.id === noPlan.id)?.planName).toBeNull();
    expect(all.some((o) => o.id === SCOUT_NETWORK_ORG_ID)).toBe(true);
    const names = all.map((o) => o.name);
    const collator = new Intl.Collator("en-ZA", { sensitivity: "base" });
    expect(names).toEqual([...names].sort(collator.compare));
  });
});
