import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/server/auth/session";
import { rawDb } from "@/server/db/raw";
import { TenantScopeError } from "@/server/db/scoped";
import { recordConsent } from "@/server/consent/records";
import { createConsentRequest } from "@/server/consent/requests";
import { createTeam } from "@/server/squad/teams";
import { guardianGrant, namedPlayer } from "./helpers/consent";
import { fixtures } from "./helpers/fixtures";

// C05 acceptance: no path edits a consent row in place (CONS01, PRD "Rules the
// schema must enforce"). The scoped client refuses it, and so does Postgres.

vi.mock("@/server/consent/jobs", () => ({ enqueueConsentWithdrawn: vi.fn(async () => {}) }));

const f = fixtures();
let ctx: AuthContext;
let orgId: string;
let playerId: string;
let consentId: string;

beforeAll(async () => {
  const org = await f.org("Consent append-only FC");
  orgId = org.id;
  const owner = await f.user("Append Owner");
  await f.member(org.id, owner.id, "owner");
  ctx = await f.ctx(owner, org.id);
  const team = await createTeam(ctx, { name: "U13 Boys", season: "2026" });
  playerId = (await namedPlayer(ctx, team.id)).id;
  consentId = (await recordConsent(ctx, playerId, guardianGrant())).consentId;
});

afterAll(async () => {
  await f.cleanup();
});

const errorOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e as Error,
  );

describe("the scoped client", () => {
  it.each([
    ["update", () => ctx.db.consent.update({ where: { id: consentId }, data: { grantedBy: "X" } })],
    ["updateMany", () => ctx.db.consent.updateMany({ where: {}, data: { grantedBy: "X" } })],
    [
      "upsert",
      () =>
        ctx.db.consent.upsert({
          where: { id: consentId },
          update: { grantedBy: "X" },
          create: {
            organisationId: orgId,
            playerId,
            state: "none",
            clubStats: false,
            scoutVisible: false,
            playerWasMinor: true,
          },
        }),
    ],
    ["delete", () => ctx.db.consent.delete({ where: { id: consentId } })],
    ["deleteMany", () => ctx.db.consent.deleteMany({ where: {} })],
  ])("refuses consent.%s", async (_op, run) => {
    const err = await errorOf(run());
    expect(err).toBeInstanceOf(TenantScopeError);
    expect(err!.message).toContain("append-only");
  });

  it("refuses consentState in player.update, updateMany and create data", async () => {
    for (const run of [
      () => ctx.db.player.update({ where: { id: playerId }, data: { consentState: "none" } }),
      () => ctx.db.player.updateMany({ where: {}, data: { consentState: "none" } }),
      () =>
        ctx.db.player.create({
          data: { organisationId: orgId, firstName: "X", consentState: "scout_visible" },
        }),
    ]) {
      const err = await errorOf(run());
      expect(err).toBeInstanceOf(TenantScopeError);
      expect(err!.message).toContain("consentState");
    }
    expect((await rawDb.player.findUniqueOrThrow({ where: { id: playerId } })).consentState).toBe(
      "scout_visible",
    );
  });
});

describe("Postgres", () => {
  it("raises on a raw UPDATE of a consent row", async () => {
    const err = await errorOf(
      rawDb.$executeRaw`UPDATE "Consent" SET "grantedBy" = 'X' WHERE "id" = ${consentId}`,
    );
    expect(String(err)).toContain("append-only");
    const err2 = await errorOf(
      rawDb.consent.update({ where: { id: consentId }, data: { state: "withdrawn" } }),
    );
    expect(String(err2)).toContain("append-only");
  });

  it("raises on a raw DELETE of a consent row", async () => {
    const err = await errorOf(rawDb.$executeRaw`DELETE FROM "Consent" WHERE "id" = ${consentId}`);
    expect(String(err)).toContain("append-only");
    expect(await rawDb.consent.count({ where: { id: consentId } })).toBe(1);
  });

  it("raises on a raw UPDATE of Player.consentState", async () => {
    const err = await errorOf(
      rawDb.$executeRaw`UPDATE "Player" SET "consentState" = 'withdrawn' WHERE "id" = ${playerId}`,
    );
    expect(String(err)).toContain("consentState");
  });

  it("raises on a player insert with consentState scout_visible", async () => {
    const err = await errorOf(
      rawDb.player.create({
        data: { organisationId: orgId, firstName: "Y", consentState: "scout_visible" },
      }),
    );
    expect(String(err)).toContain("consentState");
  });

  it("lets other player updates through", async () => {
    await rawDb.player.update({ where: { id: playerId }, data: { heightCm: 160 } });
  });

  it("nulls recordedBy when the recording user is deleted, and changes nothing else", async () => {
    const recorder = await f.user("Short-lived Admin");
    await f.member(orgId, recorder.id, "admin");
    const rctx = await f.ctx(recorder, orgId);
    const { consentId: id } = await recordConsent(rctx, playerId, guardianGrant());
    const before = await rawDb.consent.findUniqueOrThrow({ where: { id } });
    await rawDb.user.delete({ where: { id: recorder.id } });
    const after = await rawDb.consent.findUniqueOrThrow({ where: { id } });
    expect(after.recordedById).toBeNull();
    expect({ ...after, recordedById: before.recordedById }).toEqual(before);
  });

  it("still cascades when the organisation is deleted", async () => {
    const other = await f.org("Consent cascade FC");
    const owner = await f.user("Cascade Owner");
    await f.member(other.id, owner.id, "owner");
    const octx = await f.ctx(owner, other.id);
    const team = await createTeam(octx, { name: "U12", season: "2026" });
    const p = await namedPlayer(octx, team.id);
    // A requested row points at the link (Consent.requestId, a NO ACTION key).
    await createConsentRequest(octx, p.id);
    await recordConsent(octx, p.id, guardianGrant());
    expect(await rawDb.consent.count({ where: { playerId: p.id, requestId: { not: null } } })).toBe(
      1,
    );
    await rawDb.organisation.delete({ where: { id: other.id } });
    expect(await rawDb.consent.count({ where: { playerId: p.id } })).toBe(0);
    expect(await rawDb.consentRequest.count({ where: { playerId: p.id } })).toBe(0);
  });

  it("still cascades when a player with a linked consent row is deleted", async () => {
    const team = await createTeam(ctx, { name: "U12 Cascade", season: "2026" });
    const p = await namedPlayer(ctx, team.id);
    await createConsentRequest(ctx, p.id);
    await rawDb.player.delete({ where: { id: p.id } });
    expect(await rawDb.consent.count({ where: { playerId: p.id } })).toBe(0);
    expect(await rawDb.consentRequest.count({ where: { playerId: p.id } })).toBe(0);
  });
});

// CONS02 in the database: the trigger derives playerWasMinor from the date of
// birth on the decision date (Africa/Johannesburg) and ignores the caller's.
describe("Postgres derives playerWasMinor", () => {
  let teamId: string;
  beforeAll(async () => {
    teamId = (await createTeam(ctx, { name: "U14 Minors", season: "2026" })).id;
  });

  const selfGrant = (pid: string, extra: Record<string, unknown> = {}) => ({
    organisationId: orgId,
    playerId: pid,
    state: "club_only" as const,
    clubStats: true,
    scoutVisible: false,
    grantedBy: "The player",
    relationship: "self" as const,
    method: "in_person" as const,
    wordingVersion: "test",
    playerWasMinor: false,
    grantedAt: new Date(),
    ...extra,
  });

  it("refuses a 14-year-old's own grant written with playerWasMinor false (raw client)", async () => {
    const p = await namedPlayer(ctx, teamId, { age: 14 });
    const err = await errorOf(rawDb.consent.create({ data: selfGrant(p.id) }));
    expect(String(err)).toContain("parent or guardian");
    expect(await rawDb.consent.count({ where: { playerId: p.id } })).toBe(0);
    expect((await rawDb.player.findUniqueOrThrow({ where: { id: p.id } })).consentState).toBe(
      "none",
    );
  });

  it("refuses it through the scoped client too", async () => {
    const p = await namedPlayer(ctx, teamId, { age: 14 });
    const err = await errorOf(ctx.db.consent.create({ data: selfGrant(p.id) }));
    expect(String(err)).toContain("parent or guardian");
    expect(await rawDb.consent.count({ where: { playerId: p.id } })).toBe(0);
  });

  it("refuses an own grant for a player with no date of birth", async () => {
    const p = await rawDb.player.create({
      data: { organisationId: orgId, firstName: "Nodob", lastName: "Player", teamId },
    });
    const err = await errorOf(rawDb.consent.create({ data: selfGrant(p.id) }));
    expect(String(err)).toContain("parent or guardian");
  });

  it("refuses an own grant future-dated past a 17-year-old's 18th birthday", async () => {
    const p = await namedPlayer(ctx, teamId, { age: 17 });
    const err = await errorOf(
      rawDb.consent.create({
        data: selfGrant(p.id, { grantedAt: new Date(Date.now() + 2 * 365 * 864e5) }),
      }),
    );
    expect(String(err)).toContain("parent or guardian");
    expect(await rawDb.consent.count({ where: { playerId: p.id } })).toBe(0);
  });

  it("refuses an own grant dated before the 18th birthday", async () => {
    const p = await namedPlayer(ctx, teamId, { age: 19 });
    const err = await errorOf(
      rawDb.consent.create({
        data: selfGrant(p.id, { grantedAt: new Date(Date.now() - 2 * 365 * 864e5) }),
      }),
    );
    expect(String(err)).toContain("parent or guardian");
  });

  it("overrides the caller's value both ways", async () => {
    const minor = await namedPlayer(ctx, teamId, { age: 14 });
    const refusal = await rawDb.consent.create({
      data: {
        organisationId: orgId,
        playerId: minor.id,
        state: "none",
        clubStats: false,
        scoutVisible: false,
        grantedBy: "Thandi Mokoena",
        relationship: "parent",
        method: "paper_form",
        playerWasMinor: false,
        grantedAt: new Date(),
      },
    });
    expect(refusal.playerWasMinor).toBe(true);
    const adult = await namedPlayer(ctx, teamId, { age: 19 });
    const own = await rawDb.consent.create({ data: selfGrant(adult.id, { playerWasMinor: true }) });
    expect(own.playerWasMinor).toBe(false);
    expect(own.state).toBe("club_only");
  });

  it("counts the 18th birthday by the calendar day in South Africa", async () => {
    const p = await rawDb.player.create({
      data: {
        organisationId: orgId,
        firstName: "Birthday",
        lastName: "Player",
        teamId,
        dateOfBirth: new Date("2008-06-15T00:00:00Z"),
      },
    });
    // 14 June 2026 23:30 in South Africa (21:30 UTC): still 17.
    const before = await errorOf(
      rawDb.consent.create({
        data: selfGrant(p.id, { grantedAt: new Date("2026-06-14T21:30:00Z") }),
      }),
    );
    expect(String(before)).toContain("parent or guardian");
    // 15 June 2026 00:30 in South Africa (22:30 UTC on the 14th): 18.
    const on = await rawDb.consent.create({
      data: selfGrant(p.id, { grantedAt: new Date("2026-06-14T22:30:00Z") }),
    });
    expect(on.playerWasMinor).toBe(false);
  });
});
