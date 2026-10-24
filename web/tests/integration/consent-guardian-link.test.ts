import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/server/auth/session";
import { rawDb } from "@/server/db/raw";
import { ConsentError } from "@/server/consent/errors";
import {
  guardianDecide,
  GuardianInputError,
  GuardianLinkError,
  guardianView,
  guardianWithdraw,
} from "@/server/consent/guardian";
import { recordConsent, withdrawConsent } from "@/server/consent/records";
import {
  createConsentRequest,
  openConsentRequest,
  revokeConsentRequest,
} from "@/server/consent/requests";
import { CONSENT_WORDING_VERSION } from "@/server/consent/wording";
import { markDeparted } from "@/server/squad/players";
import { createTeam } from "@/server/squad/teams";
import { guardianDecisionAction } from "@/app/consent/[token]/actions";
import { todayIso } from "@/lib/squad-fields";
import { dobYearsAgo, guardianGrant, namedPlayer } from "./helpers/consent";
import { fixtures } from "./helpers/fixtures";

// Guardian links (CONS02, CONS03, NFR11; docs/build/design/C05.md, Surface 1).

const jobs = vi.hoisted(() => ({ enqueueConsentWithdrawn: vi.fn(async () => {}) }));
vi.mock("@/server/consent/jobs", () => jobs);

// The guardian actions end in redirect(); capture the target instead.
const nav = vi.hoisted(() => {
  class Redirect extends Error {
    constructor(readonly url: string) {
      super(`redirect ${url}`);
    }
  }
  return {
    Redirect,
    redirect: (url: string) => {
      throw new Redirect(url);
    },
  };
});
vi.mock("next/navigation", () => ({ redirect: nav.redirect }));

const f = fixtures();
let ctx: AuthContext;
let teamId: string;

beforeAll(async () => {
  const org = await f.org("Consent link FC");
  const owner = await f.user("Link Owner");
  await f.member(org.id, owner.id, "admin");
  ctx = await f.ctx(owner, org.id);
  teamId = (await createTeam(ctx, { name: "U11", season: "2026" })).id;
});

afterAll(async () => {
  await f.cleanup();
});

beforeEach(() => jobs.enqueueConsentWithdrawn.mockClear());

const tokenOf = (url: string) => url.split("/consent/")[1]!;
const errorOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e as Error,
  );
const answer = (extra: Record<string, string> = {}) => ({
  wordingVersion: CONSENT_WORDING_VERSION,
  club: "yes",
  scouts: "no",
  guardianName: "Thandi Mokoena",
  relationship: "parent",
  confirm: "on",
  ...extra,
});

describe("creating a link", () => {
  it("stores only the sha256 hash and returns the URL once", async () => {
    const p = await namedPlayer(ctx, teamId);
    const { url, requestId } = await createConsentRequest(ctx, p.id);
    const token = tokenOf(url);
    expect(token.length).toBeGreaterThanOrEqual(43);
    const row = await rawDb.consentRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(row.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(token);
    const audits = await rawDb.auditLog.findMany({
      where: { action: "consent.request", targetId: p.id },
    });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0]!.metadata)).not.toContain(token);
  });

  it("writes a requested row only from none or withdrawn", async () => {
    const p = await namedPlayer(ctx, teamId);
    expect((await createConsentRequest(ctx, p.id)).state).toBe("requested");
    expect((await createConsentRequest(ctx, p.id)).state).toBe("requested");
    expect(await rawDb.consent.count({ where: { playerId: p.id, state: "requested" } })).toBe(1);
    await recordConsent(ctx, p.id, guardianGrant({ scoutVisible: "no" }));
    expect((await createConsentRequest(ctx, p.id)).state).toBe("club_only");
    await withdrawConsent(ctx, p.id, { requestedBy: "Thandi", method: "email" });
    expect((await createConsentRequest(ctx, p.id)).state).toBe("requested");
    expect(await rawDb.consent.count({ where: { playerId: p.id, state: "requested" } })).toBe(2);
    const req = await rawDb.consent.findFirstOrThrow({
      where: { playerId: p.id, state: "requested" },
    });
    expect(req.method).toBe("guardian_link");
    expect(req.requestId).not.toBeNull();
  });

  it("revokes the earlier link: the old one is closed, the new one decides", async () => {
    const p = await namedPlayer(ctx, teamId);
    const first = tokenOf((await createConsentRequest(ctx, p.id)).url);
    const second = tokenOf((await createConsentRequest(ctx, p.id)).url);
    expect(await guardianView(first)).toMatchObject({ mode: "closed", reason: "revoked" });
    expect(await guardianView(second)).toMatchObject({ mode: "decide", firstName: "Lebo" });
    expect(await rawDb.consentRequest.count({ where: { playerId: p.id, revokedAt: null } })).toBe(
      1,
    );
  });

  it("refuses a link for a player of 18 or over, and for a departed player", async () => {
    const adult = await namedPlayer(ctx, teamId, { age: 18 });
    const err = await errorOf(createConsentRequest(ctx, adult.id));
    expect((err as ConsentError).code).toBe("adult");
    const gone = await namedPlayer(ctx, teamId);
    await markDeparted(ctx, gone.id);
    expect(((await errorOf(createConsentRequest(ctx, gone.id))) as ConsentError).code).toBe(
      "departed",
    );
  });

  it("turns off a link: closed, and the consent state stays", async () => {
    const p = await namedPlayer(ctx, teamId);
    const token = tokenOf((await createConsentRequest(ctx, p.id)).url);
    expect(await openConsentRequest(ctx, p.id)).not.toBeNull();
    await revokeConsentRequest(ctx, p.id);
    expect(await openConsentRequest(ctx, p.id)).toBeNull();
    expect(await guardianView(token)).toMatchObject({ mode: "closed", reason: "revoked" });
    expect((await rawDb.player.findUniqueOrThrow({ where: { id: p.id } })).consentState).toBe(
      "requested",
    );
    expect(((await errorOf(revokeConsentRequest(ctx, p.id))) as ConsentError).code).toBe("no_link");
    expect(
      await rawDb.auditLog.count({ where: { action: "consent.request_revoke", targetId: p.id } }),
    ).toBe(1);
  });

  it("answers an unknown token as closed", async () => {
    expect(await guardianView("not-a-token")).toEqual({ mode: "closed", reason: "unknown" });
    expect(await guardianView("")).toEqual({ mode: "closed", reason: "unknown" });
  });
});

describe("deciding through a link", () => {
  it("records method guardian_link, no recording user, and an audit row with no actor", async () => {
    const p = await namedPlayer(ctx, teamId);
    const token = tokenOf((await createConsentRequest(ctx, p.id)).url);
    const res = await guardianDecide(token, answer());
    expect(res.state).toBe("club_only");
    const row = await rawDb.consent.findUniqueOrThrow({ where: { id: res.consentId } });
    expect(row).toMatchObject({
      method: "guardian_link",
      recordedById: null,
      grantedBy: "Thandi Mokoena",
      relationship: "parent",
      wordingVersion: CONSENT_WORDING_VERSION,
      playerWasMinor: true,
    });
    const audit = await rawDb.auditLog.findFirstOrThrow({
      where: { targetId: p.id, action: "consent.record" },
    });
    expect(audit.actorUserId).toBeNull();
    expect(JSON.stringify(audit.metadata)).not.toContain("Thandi");
    const view = await guardianView(token);
    expect(view).toMatchObject({ mode: "decide", state: "club_only" });
    expect(await rawDb.consentRequest.findFirst({ where: { playerId: p.id } })).toMatchObject({
      lastUsedAt: expect.any(Date),
    });
  });

  it("refuses an unclear form with the first error code", async () => {
    const p = await namedPlayer(ctx, teamId);
    const token = tokenOf((await createConsentRequest(ctx, p.id)).url);
    const code = async (input: Record<string, string>) =>
      ((await errorOf(guardianDecide(token, input))) as GuardianInputError).code;
    expect(await code(answer({ guardianName: "" }))).toBe("name");
    expect(await code(answer({ guardianName: "x".repeat(121) }))).toBe("name");
    expect(await code(answer({ relationship: "self" }))).toBe("relationship");
    expect(await code(answer({ confirm: "" }))).toBe("confirm");
    expect(await code(answer({ club: "no", scouts: "yes" }))).toBe("answers");
    expect(
      await rawDb.consent.count({ where: { playerId: p.id, state: { not: "requested" } } }),
    ).toBe(0);
  });

  it("lets an expired link withdraw but not decide", async () => {
    const p = await namedPlayer(ctx, teamId);
    const { url, requestId } = await createConsentRequest(ctx, p.id);
    const token = tokenOf(url);
    await guardianDecide(token, answer({ scouts: "yes" }));
    await rawDb.consentRequest.update({
      where: { id: requestId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await guardianView(token)).toMatchObject({ mode: "withdraw_only", reason: "expired" });
    const err = await errorOf(guardianDecide(token, answer()));
    expect(err).toBeInstanceOf(GuardianLinkError);
    const res = await guardianWithdraw(token);
    const row = await rawDb.consent.findUniqueOrThrow({ where: { id: res.consentId } });
    expect(row).toMatchObject({ state: "withdrawn", method: "guardian_link", recordedById: null });
    expect(jobs.enqueueConsentWithdrawn).toHaveBeenCalledTimes(1);
    // Nothing granted any more: the expired link is now closed.
    expect(await guardianView(token)).toMatchObject({ mode: "closed", reason: "expired" });
    expect(((await errorOf(guardianWithdraw(token))) as GuardianLinkError).code).toBe("closed");
  });

  it("closes a revoked or replaced link, even with a grant", async () => {
    const p = await namedPlayer(ctx, teamId);
    const token = tokenOf((await createConsentRequest(ctx, p.id)).url);
    await guardianDecide(token, answer());
    await createConsentRequest(ctx, p.id);
    expect(await guardianView(token)).toMatchObject({ mode: "closed", reason: "revoked" });
    expect(await errorOf(guardianWithdraw(token))).toBeInstanceOf(GuardianLinkError);
    expect(await errorOf(guardianDecide(token, answer()))).toBeInstanceOf(GuardianLinkError);
  });

  it("lets a departed player's guardian withdraw only", async () => {
    const p = await namedPlayer(ctx, teamId);
    const token = tokenOf((await createConsentRequest(ctx, p.id)).url);
    await guardianDecide(token, answer());
    await markDeparted(ctx, p.id);
    expect(await guardianView(token)).toMatchObject({ mode: "withdraw_only", reason: "departed" });
    await guardianWithdraw(token);
    expect((await rawDb.player.findUniqueOrThrow({ where: { id: p.id } })).consentState).toBe(
      "withdrawn",
    );
  });

  it("records a no from the guardian as a refusal (none) first, a withdrawal after a grant", async () => {
    const p = await namedPlayer(ctx, teamId);
    const token = tokenOf((await createConsentRequest(ctx, p.id)).url);
    expect((await guardianDecide(token, answer({ club: "no", scouts: "no" }))).state).toBe("none");
    expect((await guardianDecide(token, answer())).state).toBe("club_only");
    expect((await guardianDecide(token, answer({ club: "no", scouts: "no" }))).state).toBe(
      "withdrawn",
    );
  });
});

/** No name of a player or guardian in an audit row's metadata. */
const NAMES = ["Lebo", "Mokoena", "Thandi", "Sipho"];
const expectNoNames = (metadata: unknown) => {
  const text = JSON.stringify(metadata);
  for (const name of NAMES) expect(text).not.toContain(name);
};

describe("withdrawing through a link is audited", () => {
  it.each([
    [
      "expired link",
      async (_playerId: string, requestId: string) => {
        await rawDb.consentRequest.update({
          where: { id: requestId },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
      },
    ],
    ["departed player", async (playerId: string) => void (await markDeparted(ctx, playerId))],
  ])("%s: one consent.withdraw row, no actor, no names", async (_case, close) => {
    const p = await namedPlayer(ctx, teamId);
    const { url, requestId } = await createConsentRequest(ctx, p.id);
    const token = tokenOf(url);
    await guardianDecide(token, answer({ scouts: "yes" }));
    await close(p.id, requestId);
    expect(await guardianView(token)).toMatchObject({ mode: "withdraw_only" });
    const res = await guardianWithdraw(token);
    const audits = await rawDb.auditLog.findMany({
      where: { organisationId: ctx.organisationId, targetId: p.id, action: "consent.withdraw" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorUserId).toBeNull();
    expect(audits[0]!.metadata).toMatchObject({
      consentId: res.consentId,
      requestId,
      from: "scout_visible",
      to: "withdrawn",
      method: "guardian_link",
    });
    expectNoNames(audits[0]!.metadata);
  });
});

/**
 * Runs `during` while another transaction holds the player row lock and has
 * made `change` (not yet committed): guardianView before the lock sees the old
 * state. Commits the change once `during` waits on the lock, then returns
 * `during`'s error, or null.
 */
async function raceWithLockedChange(
  playerId: string,
  change: (tx: Parameters<Parameters<typeof rawDb.$transaction>[0]>[0]) => Promise<unknown>,
  during: () => Promise<unknown>,
): Promise<Error | null> {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let changed!: () => void;
  const ready = new Promise<void>((r) => (changed = r));
  const holder = rawDb.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "Player" WHERE "id" = ${playerId} FOR UPDATE`;
      await change(tx);
      changed();
      await gate;
    },
    { timeout: 20_000 },
  );
  await ready;
  const result = errorOf(during());
  // Wait until the guardian's transaction blocks on the player row lock.
  for (let i = 0; ; i++) {
    const [{ n }] = await rawDb.$queryRaw<[{ n: number }]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'
         AND query LIKE '%FOR UPDATE%'`;
    if (n > 0) break;
    if (i > 200) throw new Error("the guardian decision never waited on the player lock");
    await new Promise((r) => setTimeout(r, 25));
  }
  release();
  await holder;
  return result;
}

describe("a decision re-checks the link under the player lock", () => {
  it.each([
    [
      "the player departs",
      (playerId: string) => (tx: Parameters<Parameters<typeof rawDb.$transaction>[0]>[0]) =>
        tx.player.update({
          where: { id: playerId },
          data: { clubStatus: "departed", departedAt: new Date() },
        }),
    ],
    [
      "the player's date of birth makes them 18",
      (playerId: string) => (tx: Parameters<Parameters<typeof rawDb.$transaction>[0]>[0]) =>
        tx.player.update({
          where: { id: playerId },
          data: { dateOfBirth: new Date(`${dobYearsAgo(19)}T00:00:00Z`) },
        }),
    ],
    [
      "the organisation is suspended",
      () => (tx: Parameters<Parameters<typeof rawDb.$transaction>[0]>[0]) =>
        tx.organisation.update({
          where: { id: ctx.organisationId },
          data: { status: "suspended" },
        }),
    ],
  ])("closes the link and writes nothing when %s meanwhile", async (_case, makeChange) => {
    const p = await namedPlayer(ctx, teamId);
    const token = tokenOf((await createConsentRequest(ctx, p.id)).url);
    expect(await guardianView(token)).toMatchObject({ mode: "decide" });
    try {
      const err = await raceWithLockedChange(p.id, makeChange(p.id), () =>
        guardianDecide(token, answer()),
      );
      expect(err).toBeInstanceOf(GuardianLinkError);
      expect((err as GuardianLinkError).code).toBe("closed");
      expect(
        await rawDb.consent.count({ where: { playerId: p.id, state: { not: "requested" } } }),
      ).toBe(0);
      expect(
        await rawDb.auditLog.count({ where: { targetId: p.id, action: "consent.record" } }),
      ).toBe(0);
    } finally {
      await rawDb.organisation.update({
        where: { id: ctx.organisationId },
        data: { status: "active" },
      });
    }
  });

  it("stores playerWasMinor from the date of birth read under the lock", async () => {
    const p = await namedPlayer(ctx, teamId, { age: 17 });
    const token = tokenOf((await createConsentRequest(ctx, p.id)).url);
    const res = await guardianDecide(token, answer());
    const row = await rawDb.consent.findUniqueOrThrow({ where: { id: res.consentId } });
    expect(row.playerWasMinor).toBe(true);
    const audit = await rawDb.auditLog.findFirstOrThrow({
      where: { targetId: p.id, action: "consent.record" },
    });
    expect(audit.metadata).toMatchObject({ playerWasMinor: true });
  });
});

describe("an adult's own consent closes the guardian links", () => {
  it("revokes open links in the same transaction, and the old link cannot withdraw", async () => {
    const p = await namedPlayer(ctx, teamId, { age: 17 });
    const { url, requestId } = await createConsentRequest(ctx, p.id);
    const token = tokenOf(url);
    await guardianDecide(token, answer({ scouts: "yes" }));
    // The player turns 18: the guardian link may still withdraw the guardian's grant.
    await rawDb.player.update({
      where: { id: p.id },
      data: { dateOfBirth: new Date(`${dobYearsAgo(18, 3)}T00:00:00Z`) },
    });
    expect(await guardianView(token)).toMatchObject({ mode: "withdraw_only", reason: "adult" });

    const own = await recordConsent(ctx, p.id, {
      relationship: "self",
      method: "in_person",
      grantedAt: todayIso(),
      clubStats: "yes",
      scoutVisible: "yes",
      seenWording: "on",
    });
    const req = await rawDb.consentRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(req.revokedAt).not.toBeNull();
    const revokes = await rawDb.auditLog.findMany({
      where: { targetId: p.id, action: "consent.request_revoke" },
    });
    expect(revokes).toHaveLength(1);
    expect(revokes[0]!.metadata).toEqual({
      requestIds: [requestId],
      consentId: own.consentId,
      reason: "self_consent",
    });
    expectNoNames(revokes[0]!.metadata);

    expect(await guardianView(token)).toMatchObject({ mode: "closed" });
    const err = await errorOf(guardianWithdraw(token));
    expect(err).toBeInstanceOf(GuardianLinkError);
    expect((err as GuardianLinkError).code).toBe("closed");
    expect((await rawDb.player.findUniqueOrThrow({ where: { id: p.id } })).consentState).toBe(
      "scout_visible",
    );
  });

  it("refuses a withdrawal through a link that is still open once the newest grant is 'self'", async () => {
    const p = await namedPlayer(ctx, teamId, { age: 17 });
    const { url, requestId } = await createConsentRequest(ctx, p.id);
    const token = tokenOf(url);
    await guardianDecide(token, answer());
    await rawDb.player.update({
      where: { id: p.id },
      data: { dateOfBirth: new Date(`${dobYearsAgo(18, 3)}T00:00:00Z`) },
    });
    await recordConsent(ctx, p.id, {
      relationship: "self",
      method: "in_person",
      grantedAt: todayIso(),
      clubStats: "yes",
      scoutVisible: "no",
      seenWording: "on",
    });
    // A link left open (written before links were turned off on a 'self' grant).
    await rawDb.consentRequest.update({ where: { id: requestId }, data: { revokedAt: null } });
    expect(await guardianView(token)).toMatchObject({ mode: "closed", reason: "adult" });
    expect(((await errorOf(guardianWithdraw(token))) as GuardianLinkError).code).toBe("closed");
    expect(
      await rawDb.consent.count({
        where: { playerId: p.id, method: "guardian_link", state: "withdrawn" },
      }),
    ).toBe(0);
  });
});

describe("the decision needs the wording version from the about step (NFR09)", () => {
  it.each([
    ["missing", {}],
    ["empty", { wordingVersion: "" }],
    ["old", { wordingVersion: "2000-01" }],
  ])("guardianDecide refuses a %s wording version and writes nothing", async (_case, extra) => {
    const p = await namedPlayer(ctx, teamId);
    const token = tokenOf((await createConsentRequest(ctx, p.id)).url);
    const input: Record<string, string> = { ...answer(), ...extra };
    if (!("wordingVersion" in extra)) delete input.wordingVersion;
    const err = await errorOf(guardianDecide(token, input));
    expect(err).toBeInstanceOf(GuardianInputError);
    expect((err as GuardianInputError).code).toBe("wording");
    expect(
      await rawDb.consent.count({ where: { playerId: p.id, state: { not: "requested" } } }),
    ).toBe(0);
  });

  const form = (token: string, wording: string | null) => {
    const fd = new FormData();
    fd.set("token", token);
    if (wording !== null) fd.set("wording", wording);
    fd.set("club", "yes");
    fd.set("scouts", "no");
    fd.set("guardianName", "Thandi Mokoena");
    fd.set("relationship", "parent");
    fd.set("confirm", "on");
    return fd;
  };
  const redirectOf = async (p: Promise<unknown>) => {
    const err = await errorOf(p);
    expect(err).toBeInstanceOf(nav.Redirect);
    return (err as InstanceType<typeof nav.Redirect>).url;
  };

  it.each([
    ["missing", null],
    ["old", "2000-01"],
  ])("the action sends a %s wording version back to the about step", async (_case, wording) => {
    const p = await namedPlayer(ctx, teamId);
    const token = tokenOf((await createConsentRequest(ctx, p.id)).url);
    expect(await redirectOf(guardianDecisionAction(form(token, wording)))).toBe(
      `/consent/${token}?step=about`,
    );
    expect(
      await rawDb.consent.count({ where: { playerId: p.id, state: { not: "requested" } } }),
    ).toBe(0);
  });

  it("the action saves with the current version and carries it on an input error", async () => {
    const p = await namedPlayer(ctx, teamId);
    const token = tokenOf((await createConsentRequest(ctx, p.id)).url);
    const bad = form(token, CONSENT_WORDING_VERSION);
    bad.set("confirm", "");
    const back = new URL(await redirectOf(guardianDecisionAction(bad)), "http://x");
    expect(back.searchParams.get("step")).toBe("you");
    expect(back.searchParams.get("error")).toBe("confirm");
    expect(back.searchParams.get("wording")).toBe(CONSENT_WORDING_VERSION);
    expect(back.search).not.toContain("Thandi");
    expect(await redirectOf(guardianDecisionAction(form(token, CONSENT_WORDING_VERSION)))).toBe(
      `/consent/${token}?step=done`,
    );
    const row = await rawDb.consent.findFirstOrThrow({
      where: { playerId: p.id, state: "club_only" },
    });
    expect(row.wordingVersion).toBe(CONSENT_WORDING_VERSION);
  });
});
