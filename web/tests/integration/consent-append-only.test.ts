import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/server/auth/session";
import { rawDb } from "@/server/db/raw";
import { TenantScopeError } from "@/server/db/scoped";
import { recordConsent } from "@/server/consent/records";
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
    await recordConsent(octx, p.id, guardianGrant());
    await rawDb.organisation.delete({ where: { id: other.id } });
    expect(await rawDb.consent.count({ where: { playerId: p.id } })).toBe(0);
  });
});
