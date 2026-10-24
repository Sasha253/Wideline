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
import { guardianGrant, namedPlayer } from "./helpers/consent";
import { fixtures } from "./helpers/fixtures";

// Guardian links (CONS02, CONS03, NFR11; docs/build/design/C05.md, Surface 1).

const jobs = vi.hoisted(() => ({ enqueueConsentWithdrawn: vi.fn(async () => {}) }));
vi.mock("@/server/consent/jobs", () => jobs);

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
