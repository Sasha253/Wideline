import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/server/auth/session";
import { rawDb } from "@/server/db/raw";
import { ConsentError } from "@/server/consent/errors";
import { guardianView } from "@/server/consent/guardian";
import {
  createConsentRequest,
  emailConsentRequest,
  openConsentRequest,
  revokeConsentRequest,
} from "@/server/consent/requests";
import { log } from "@/server/log";
import { createTeam } from "@/server/squad/teams";
import { formatDate } from "@/lib/labels";
import { namedPlayer } from "./helpers/consent";
import { fixtures } from "./helpers/fixtures";

// Q-019: Wideline emails the guardian link when the club gives the guardian's
// address (docs/build/design/C05.md, Surface 4 and "Guardian link email"). The
// address is personal data: it is stored on the request only, never in audit
// metadata or a log line. A failed send keeps the link.

const sendMail = vi.hoisted(() => vi.fn());
vi.mock("@/server/mail", () => ({ sendMail }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// requireRole with the real role rule, over a context the test picks.
const auth = vi.hoisted(() => ({ current: null as AuthContext | null }));
vi.mock("@/server/auth/session", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/auth/session")>();
  return {
    ...real,
    requireRole: async (roles: readonly string[]) => {
      const c = auth.current!;
      if (!c.roles.some((r) => roles.includes(r))) {
        throw new real.AuthzError(403, `Requires one of: ${roles.join(", ")}`);
      }
      return c;
    },
  };
});

const { requestConsentAction, emailConsentRequestAction } =
  await import("@/app/(app)/squad/players/[playerId]/consent/actions");
const { AuthzError } = await import("@/server/auth/session");

const f = fixtures();
let orgId: string;
let ctx: AuthContext;
let coachCtx: AuthContext;
let otherCtx: AuthContext;
let teamId: string;

// Everything the logger is asked to write during this file.
const logged: string[] = [];
for (const level of ["trace", "debug", "info", "warn", "error", "fatal"] as const) {
  const original = log[level].bind(log);
  vi.spyOn(log, level).mockImplementation(((...args: unknown[]) => {
    logged.push(JSON.stringify(args, (_k, v) => (v instanceof Error ? v.stack : v)));
    return (original as (...a: unknown[]) => void)(...args);
  }) as never);
}

const address = (local: string) => `${local}-${f.tag}@guardian.test`;
const tokenOf = (url: string) => url.split("/consent/")[1]!;
const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
};

beforeAll(async () => {
  const org = await f.org("Consent email FC");
  orgId = org.id;
  const admin = await f.user("Email Admin");
  await f.member(org.id, admin.id, "admin");
  ctx = await f.ctx(admin, org.id);
  const coach = await f.user("Email Coach");
  await f.member(org.id, coach.id, "coach");
  coachCtx = await f.ctx(coach, org.id);
  const other = await f.org("Other email FC");
  const otherAdmin = await f.user("Other Email Admin");
  await f.member(other.id, otherAdmin.id, "owner");
  otherCtx = await f.ctx(otherAdmin, other.id);
  teamId = (await createTeam(ctx, { name: "U12", season: "2026" })).id;
});

afterAll(async () => {
  await f.cleanup();
});

beforeEach(() => {
  sendMail.mockReset();
  auth.current = ctx;
});

describe("creating a link with the guardian's email", () => {
  it("sends one email with the link, the first name only, and the expiry date", async () => {
    const p = await namedPlayer(ctx, teamId);
    const to = address("thandi");
    const created = await createConsentRequest(ctx, p.id, new Date(), { guardianEmail: to });
    expect(created.email).toEqual({ sent: true, masked: `t***@guardian.test` });

    expect(sendMail).toHaveBeenCalledTimes(1);
    const [sentTo, subject, text, html] = sendMail.mock.calls[0]! as string[];
    expect(sentTo).toBe(to);
    expect(subject).toBe(`${ctx.organisationName} is asking about Lebo's football stats`);
    expect(text).toContain(created.url);
    expect(html).toContain(created.url);
    expect(text).toContain("We record goals, shots and where your child ran during matches.");
    expect(text).toContain("outside South Africa");
    expect(text).toContain("Independent scouts");
    expect(text).toContain("You choose on the next screen");
    expect(text).toContain(`This link works until ${formatDate(created.expiresAt)}.`);
    // Never the surname or the date of birth, in any part.
    const player = await rawDb.player.findUniqueOrThrow({ where: { id: p.id } });
    const all = [subject, text, html].join("\n");
    expect(all).not.toContain(player.lastName!);
    expect(all).not.toContain(player.dateOfBirth!.toISOString().slice(0, 10));
    expect(all).not.toContain(formatDate(player.dateOfBirth!));

    // Stored on the request, tenant-scoped, and masked when read back for the page.
    const row = await rawDb.consentRequest.findUniqueOrThrow({ where: { id: created.requestId } });
    expect(row.guardianEmail).toBe(to);
    expect(row.organisationId).toBe(orgId);
    expect((await openConsentRequest(ctx, p.id))?.emailMasked).toBe("t***@guardian.test");
    // The emailed link is the guardian consent screen.
    expect(await guardianView(tokenOf(created.url))).toMatchObject({ mode: "decide" });
  });

  it("sends nothing without an address, and refuses an invalid one before making a link", async () => {
    const p = await namedPlayer(ctx, teamId);
    const created = await createConsentRequest(ctx, p.id, new Date(), { guardianEmail: "  " });
    expect(created.email).toBeNull();
    expect(sendMail).not.toHaveBeenCalled();

    const q = await namedPlayer(ctx, teamId);
    const err = await createConsentRequest(ctx, q.id, new Date(), {
      guardianEmail: "not-an-email",
    }).catch((e: unknown) => e as ConsentError);
    expect(err).toBeInstanceOf(ConsentError);
    expect((err as ConsentError).field).toBe("guardianEmail");
    expect(await rawDb.consentRequest.count({ where: { playerId: q.id } })).toBe(0);
  });

  it("keeps the link when the email fails, and tells the club to copy it", async () => {
    const p = await namedPlayer(ctx, teamId);
    const to = address("failing");
    sendMail.mockRejectedValueOnce(
      Object.assign(new Error(`550 <${to}> rejected`), { code: "EENVELOPE" }),
    );
    const result = await requestConsentAction(null, form({ playerId: p.id, guardianEmail: to }));
    expect(result).toMatchObject({
      ok: true,
      tone: "warn",
      message:
        "Guardian link created. We could not send the email. Copy the link and send it yourself.",
    });
    const url = (result as { values: Record<string, string> }).values.url!;
    expect(await guardianView(tokenOf(url))).toMatchObject({ mode: "decide" });
    expect(await openConsentRequest(ctx, p.id)).not.toBeNull();
    const audits = await rawDb.auditLog.findMany({
      where: { action: "consent.request_emailed", targetId: p.id },
    });
    expect(audits.map((a) => a.metadata)).toEqual([
      { requestId: expect.any(String), resend: false, emailed: false },
    ]);
    expect(logged.some((l) => l.includes("consent link email failed"))).toBe(true);
  });

  it("shows the masked address after a sent email", async () => {
    const p = await namedPlayer(ctx, teamId);
    const result = await requestConsentAction(
      null,
      form({ playerId: p.id, guardianEmail: address("naledi") }),
    );
    expect(result).toMatchObject({
      ok: true,
      tone: "ok",
      message: "Guardian link created. We emailed the link to n***@guardian.test.",
    });
  });
});

describe("closing a link drops the address", () => {
  it("clears guardianEmail when the link is revoked or replaced", async () => {
    const p = await namedPlayer(ctx, teamId);
    const first = await createConsentRequest(ctx, p.id, new Date(), {
      guardianEmail: address("first"),
    });
    // Replaced by a new link: the old row keeps no address.
    const second = await createConsentRequest(ctx, p.id, new Date(), {
      guardianEmail: address("second"),
    });
    const old = await rawDb.consentRequest.findUniqueOrThrow({ where: { id: first.requestId } });
    expect(old.revokedAt).not.toBeNull();
    expect(old.guardianEmail).toBeNull();
    // Turned off: no address left anywhere for this player.
    await revokeConsentRequest(ctx, p.id);
    const rows = await rawDb.consentRequest.findMany({ where: { playerId: p.id } });
    expect(rows.map((r) => r.id)).toContain(second.requestId);
    expect(rows.every((r) => r.guardianEmail === null)).toBe(true);
  });
});

describe("emailing the link again", () => {
  it("sends a fresh link to the stored address, closes the old one, and audits ids only", async () => {
    const p = await namedPlayer(ctx, teamId);
    const to = address("sipho");
    const first = await createConsentRequest(ctx, p.id, new Date(), { guardianEmail: to });
    sendMail.mockClear();

    const again = await emailConsentRequest(ctx, p.id);
    expect(again.requestId).toBe(first.requestId);
    expect(again.expiresAt).toEqual(first.expiresAt);
    expect(again.email).toEqual({ sent: true, masked: "s***@guardian.test" });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]![0]).toBe(to);
    expect(sendMail.mock.calls[0]![2]).toContain(again.url);
    expect(again.url).not.toBe(first.url);
    expect(await guardianView(tokenOf(again.url))).toMatchObject({ mode: "decide" });
    expect(await guardianView(tokenOf(first.url))).toMatchObject({
      mode: "closed",
      reason: "unknown",
    });

    const emailed = await rawDb.auditLog.findMany({
      where: { action: "consent.request_emailed", targetId: p.id },
      orderBy: { createdAt: "asc" },
    });
    expect(emailed.map((a) => a.metadata)).toEqual([
      { requestId: first.requestId, resend: false, emailed: true },
      { requestId: first.requestId, resend: true, emailed: true },
    ]);
    const reissue = await rawDb.auditLog.findMany({
      where: { action: "consent.request_reissue", targetId: p.id },
    });
    expect(reissue.map((a) => a.metadata)).toEqual([
      { requestId: first.requestId, newAddress: false },
    ]);
  });

  it("sends to a new address and stores it", async () => {
    const p = await namedPlayer(ctx, teamId);
    await createConsentRequest(ctx, p.id);
    const to = address("zanele");
    const result = await emailConsentRequestAction(
      null,
      form({ playerId: p.id, guardianEmail: to }),
    );
    expect(result).toMatchObject({
      ok: true,
      message:
        "We made a new link, and the earlier one no longer works. We emailed the link to z***@guardian.test.",
    });
    expect(sendMail.mock.calls[0]![0]).toBe(to);
    const row = await rawDb.consentRequest.findFirstOrThrow({
      where: { playerId: p.id, revokedAt: null },
    });
    expect(row.guardianEmail).toBe(to);
  });

  it("asks for an address when none is stored, and refuses without an open link", async () => {
    const p = await namedPlayer(ctx, teamId);
    await createConsentRequest(ctx, p.id);
    const before = await rawDb.consentRequest.findFirstOrThrow({ where: { playerId: p.id } });
    expect(await emailConsentRequestAction(null, form({ playerId: p.id }))).toEqual({
      ok: false,
      fieldErrors: { guardianEmail: "Enter the guardian's email address." },
    });
    const after = await rawDb.consentRequest.findFirstOrThrow({ where: { playerId: p.id } });
    expect(after.tokenHash).toBe(before.tokenHash);

    const none = await namedPlayer(ctx, teamId);
    expect(
      await emailConsentRequestAction(
        null,
        form({ playerId: none.id, guardianEmail: address("nobody") }),
      ),
    ).toEqual({ ok: false, formError: "The link is no longer open. Create a new one." });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("keeps a new working link when the email fails", async () => {
    const p = await namedPlayer(ctx, teamId);
    await createConsentRequest(ctx, p.id, new Date(), { guardianEmail: address("fail2") });
    sendMail.mockReset();
    sendMail.mockRejectedValueOnce(new Error("SMTP down"));
    const result = await emailConsentRequestAction(null, form({ playerId: p.id }));
    expect(result).toMatchObject({
      ok: true,
      tone: "warn",
      message:
        "We made a new link, and the earlier one no longer works. We could not send the email. Copy the link and send it yourself.",
    });
    const url = (result as { values: Record<string, string> }).values.url!;
    expect(await guardianView(tokenOf(url))).toMatchObject({ mode: "decide" });
  });

  it("stays inside the organisation", async () => {
    const p = await namedPlayer(ctx, teamId);
    await createConsentRequest(ctx, p.id, new Date(), { guardianEmail: address("tenant") });
    sendMail.mockClear();
    const err = await emailConsentRequest(otherCtx, p.id, {
      guardianEmail: address("intruder"),
    }).catch((e: unknown) => e as ConsentError);
    expect((err as ConsentError).code).toBe("not_found");
    expect(await openConsentRequest(otherCtx, p.id)).toBeNull();
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("a coach", () => {
  it("cannot create or email a link", async () => {
    const p = await namedPlayer(ctx, teamId);
    auth.current = coachCtx;
    for (const action of [requestConsentAction, emailConsentRequestAction]) {
      const err = await action(
        null,
        form({ playerId: p.id, guardianEmail: address("coach") }),
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AuthzError);
      expect((err as InstanceType<typeof AuthzError>).status).toBe(403);
    }
    expect(sendMail).not.toHaveBeenCalled();
    expect(await rawDb.consentRequest.count({ where: { playerId: p.id } })).toBe(0);
  });
});

describe("the address stays out of audit rows and logs", () => {
  it("no audit row or log line of this file holds any guardian address", async () => {
    const audits = await rawDb.auditLog.findMany({ where: { organisationId: orgId } });
    expect(audits.length).toBeGreaterThan(0);
    const text = JSON.stringify(audits) + "\n" + logged.join("\n");
    expect(text).not.toMatch(/@guardian\.test/);
  });
});
