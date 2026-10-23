import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/generated/prisma/enums";
import { rawDb } from "@/server/db/raw";
import {
  acceptInvitation,
  findInvitationByToken,
  InvitationError,
} from "@/server/auth/invitations";
import type { AuthContext } from "@/server/auth/session";
import {
  createInvitation,
  InvitationRuleError,
  listInvitations,
  resendInvitation,
  revokeInvitation,
} from "@/server/organisations/invitations";
import { RoleRuleError } from "@/server/organisations/roles";
import { hashInvitationToken } from "@/server/organisations/tokens";
import { fixtures } from "./helpers/fixtures";

// AUTH04: invitations by email with a role, 14-day expiry, accept creates or
// links a user. C01 acceptance: an expired invitation cannot be accepted.

const sendMail = vi.hoisted(() => vi.fn());
vi.mock("@/server/mail", () => ({ sendMail }));

const f = fixtures();
let org: { id: string };
let owner: { id: string; name: string; email: string };
let admin: { id: string; name: string; email: string };
let asOwner: AuthContext;
let asAdmin: AuthContext;

/** Invites an email and returns the raw token from the mocked email. */
async function invite(ctx: AuthContext, email: string, role: Role = "coach", name?: string) {
  sendMail.mockClear();
  const sent = await createInvitation(ctx, { email, role, name });
  const text = sendMail.mock.calls.at(-1)![2] as string;
  const token = text.match(/\/invite\/([\w-]+)/)![1]!;
  return { sent, token };
}

const email = (local: string) => `${local}-${f.tag}@test.local`;

beforeAll(async () => {
  org = await f.org("Invite FC");
  owner = await f.user("Owner Person");
  admin = await f.user("Admin Person");
  await f.member(org.id, owner.id, "owner");
  await f.member(org.id, admin.id, "admin");
  asOwner = await f.ctx(owner, org.id);
  asAdmin = await f.ctx(admin, org.id);
});

beforeEach(() => {
  sendMail.mockReset();
});

afterAll(async () => {
  await f.cleanup();
});

describe("createInvitation", () => {
  it("stores only a hash, expires in 14 days, emails the /invite link and audits", async () => {
    const { sent, token } = await invite(asOwner, `  ${email("Coach").toUpperCase()} `, "coach");
    expect(sent.email).toBe(email("coach"));
    expect(sent.emailSent).toBe(true);
    const [to, subject, text] = sendMail.mock.calls[0]!;
    expect(to).toBe(email("coach"));
    expect(subject).toBe(`Owner Person invited you to Invite FC ${f.tag} on Wideline`);
    expect(text).toContain(`/invite/${token}`);

    const row = await rawDb.invitation.findUniqueOrThrow({ where: { id: sent.id } });
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toBe(hashInvitationToken(token));
    const days = (row.expiresAt.getTime() - row.createdAt.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(14, 2);

    const log = await rawDb.auditLog.findFirst({
      where: { action: "invitation.created", targetId: sent.id },
    });
    expect(log?.organisationId).toBe(org.id);
    expect(log?.actorUserId).toBe(owner.id);
  });

  it("refuses platform_admin, and an admin cannot invite an owner", async () => {
    await expect(
      createInvitation(asOwner, { email: email("pa"), role: "platform_admin" }),
    ).rejects.toBeInstanceOf(RoleRuleError);
    await expect(
      createInvitation(asAdmin, { email: email("own"), role: "owner" }),
    ).rejects.toBeInstanceOf(RoleRuleError);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("inviting again revokes the earlier pending invitation", async () => {
    const first = await invite(asAdmin, email("again"), "scout");
    const second = await invite(asAdmin, email("again"), "scout");
    expect(second.sent.replaced).toBe(true);
    const old = await rawDb.invitation.findUniqueOrThrow({ where: { id: first.sent.id } });
    expect(old.revokedAt).not.toBeNull();
    await expect(
      acceptInvitation({ token: first.token, newUser: { name: "A", password: "x".repeat(12) } }),
    ).rejects.toMatchObject({ code: "revoked" });
  });

  it("refuses someone who already holds that role", async () => {
    await expect(
      createInvitation(asOwner, { email: admin.email, role: "admin" }),
    ).rejects.toBeInstanceOf(InvitationRuleError);
  });

  it("keeps the invitation when the email fails", async () => {
    sendMail.mockRejectedValueOnce(new Error("smtp down"));
    const sent = await createInvitation(asOwner, { email: email("nomail"), role: "coach" });
    expect(sent.emailSent).toBe(false);
    const rows = await listInvitations(asOwner);
    expect(rows.find((r) => r.id === sent.id)?.status).toBe("pending");
  });
});

describe("acceptInvitation refusals", () => {
  it("refuses an expired invitation and creates no membership", async () => {
    const { sent, token } = await invite(asOwner, email("expired"));
    await rawDb.invitation.update({
      where: { id: sent.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await findInvitationByToken(token))?.state).toBe("expired");
    const err = await acceptInvitation({
      token,
      newUser: { name: "Late", password: "a-long-password" },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(InvitationError);
    expect(err.code).toBe("expired");
    expect(await rawDb.user.findUnique({ where: { email: email("expired") } })).toBeNull();
    expect(
      await rawDb.membership.count({
        where: { organisationId: org.id, user: { email: email("expired") } },
      }),
    ).toBe(0);
  });

  it("refuses revoked, already used and unknown tokens", async () => {
    const revoked = await invite(asOwner, email("revoked"));
    await revokeInvitation(asOwner, revoked.sent.id);
    await expect(
      acceptInvitation({
        token: revoked.token,
        newUser: { name: "R", password: "a-long-password" },
      }),
    ).rejects.toMatchObject({ code: "revoked" });

    const used = await invite(asOwner, email("used"));
    await acceptInvitation({
      token: used.token,
      newUser: { name: "U", password: "a-long-password" },
    });
    await f.trackUserByEmail(email("used"));
    const u = await rawDb.user.findUniqueOrThrow({ where: { email: email("used") } });
    await expect(
      acceptInvitation({ token: used.token, signedInUser: { id: u.id, email: u.email } }),
    ).rejects.toMatchObject({ code: "used" });

    await expect(
      acceptInvitation({
        token: "not-a-token",
        newUser: { name: "N", password: "a-long-password" },
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await findInvitationByToken("not-a-token")).toBeNull();
  });

  it("refuses an invitation into a pending or suspended organisation", async () => {
    for (const status of ["pending", "suspended"] as const) {
      const other = await f.org(`Inactive ${status}`);
      const otherOwner = await f.user(`Owner ${status}`);
      await f.member(other.id, otherOwner.id, "owner");
      const { token } = await invite(
        await f.ctx(otherOwner, other.id),
        email(`inactive-${status}`),
      );
      await rawDb.organisation.update({ where: { id: other.id }, data: { status } });
      expect((await findInvitationByToken(token))?.state).toBe("org_inactive");
      await expect(
        acceptInvitation({ token, newUser: { name: "I", password: "a-long-password" } }),
      ).rejects.toMatchObject({ code: "org_inactive" });
    }
  });
});

describe("acceptInvitation linking", () => {
  it("creates a user, a credential account and an accepted membership for a new email", async () => {
    const { sent, token } = await invite(asOwner, email("newbie"), "coach", "New Bie");
    const view = await findInvitationByToken(token);
    expect(view).toMatchObject({
      state: "pending",
      userExists: false,
      role: "coach",
      inviterName: "Owner Person",
    });

    const res = await acceptInvitation({
      token,
      newUser: { name: "New Bie", password: "a-long-password" },
    });
    await f.trackUserByEmail(email("newbie"));
    expect(res.createdUser).toBe(true);
    const user = await rawDb.user.findUniqueOrThrow({
      where: { email: email("newbie") },
      include: { accounts: true, memberships: true },
    });
    expect(user.emailVerified).toBe(true);
    expect(user.accounts).toHaveLength(1);
    expect(user.accounts[0]!.providerId).toBe("credential");
    expect(user.accounts[0]!.password).not.toBe("a-long-password");
    expect(user.memberships).toMatchObject([
      { organisationId: org.id, role: "coach", invitedById: owner.id },
    ]);
    expect(user.memberships[0]!.acceptedAt).not.toBeNull();
    const inv = await rawDb.invitation.findUniqueOrThrow({ where: { id: sent.id } });
    expect(inv.acceptedByUserId).toBe(user.id);

    for (const action of ["invitation.accepted", "membership.created"]) {
      expect(
        await rawDb.auditLog.count({
          where: { action, organisationId: org.id, actorUserId: user.id },
        }),
      ).toBe(1);
    }
  });

  it("links an existing user without duplicating them", async () => {
    const existing = await f.user("Existing");
    const { token } = await invite(asOwner, existing.email.toUpperCase(), "scout");
    expect((await findInvitationByToken(token))?.userExists).toBe(true);
    // Signed out with an account: the page asks them to sign in instead.
    await expect(
      acceptInvitation({ token, newUser: { name: "Dup", password: "a-long-password" } }),
    ).rejects.toMatchObject({ code: "account_exists" });

    const res = await acceptInvitation({
      token,
      signedInUser: { id: existing.id, email: existing.email },
    });
    expect(res.createdUser).toBe(false);
    expect(await rawDb.user.count({ where: { email: existing.email } })).toBe(1);
    expect(
      await rawDb.membership.count({
        where: { organisationId: org.id, userId: existing.id, role: "scout" },
      }),
    ).toBe(1);
  });

  it("refuses a signed-in user with a different email", async () => {
    const someone = await f.user("Someone Else");
    const { token } = await invite(asOwner, email("intended"));
    await expect(
      acceptInvitation({ token, signedInUser: { id: someone.id, email: someone.email } }),
    ).rejects.toMatchObject({ code: "wrong_account" });
  });

  it("two concurrent accepts of the same token give exactly one membership", async () => {
    const racer = await f.user("Racer");
    const { token } = await invite(asOwner, racer.email, "agent");
    const results = await Promise.allSettled([
      acceptInvitation({ token, signedInUser: { id: racer.id, email: racer.email } }),
      acceptInvitation({ token, signedInUser: { id: racer.id, email: racer.email } }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "used" });
    expect(
      await rawDb.membership.count({
        where: { organisationId: org.id, userId: racer.id, role: "agent" },
      }),
    ).toBe(1);
  });
});

describe("listing, resending and revoking", () => {
  it("lists open invitations with a derived status and hides accepted and revoked ones", async () => {
    const pending = await invite(asOwner, email("list-p"));
    const expired = await invite(asOwner, email("list-e"));
    await rawDb.invitation.update({
      where: { id: expired.sent.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const rows = await listInvitations(asOwner);
    expect(rows.find((r) => r.id === pending.sent.id)).toMatchObject({
      status: "pending",
      inviterName: "Owner Person",
    });
    expect(rows.find((r) => r.id === expired.sent.id)?.status).toBe("expired");
    expect(rows.every((r) => r.status === "pending" || r.status === "expired")).toBe(true);
  });

  it("resend revokes the old token and issues a new one with a fresh 14 days", async () => {
    const first = await invite(asOwner, email("resend"));
    sendMail.mockClear();
    const resent = await resendInvitation(asOwner, first.sent.id);
    expect(resent.id).not.toBe(first.sent.id);
    const newToken = (sendMail.mock.calls[0]![2] as string).match(/\/invite\/([\w-]+)/)![1]!;
    expect(newToken).not.toBe(first.token);
    expect((await findInvitationByToken(first.token))?.state).toBe("revoked");
    expect((await findInvitationByToken(newToken))?.state).toBe("pending");
    expect(
      await rawDb.auditLog.count({ where: { action: "invitation.resent", targetId: resent.id } }),
    ).toBe(1);
  });

  it("revoke audits, and a second revoke finds nothing", async () => {
    const { sent } = await invite(asOwner, email("revoke-twice"));
    await revokeInvitation(asOwner, sent.id);
    expect(
      await rawDb.auditLog.count({ where: { action: "invitation.revoked", targetId: sent.id } }),
    ).toBe(1);
    await expect(revokeInvitation(asOwner, sent.id)).rejects.toMatchObject({ code: "not_found" });
  });
});
