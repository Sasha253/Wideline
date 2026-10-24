import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/server/auth/session";
import { rawDb } from "@/server/db/raw";
import { prismaErrorCode } from "@/server/squad/errors";
import {
  ConsentError,
  consentHistory,
  recordConsent,
  withdrawConsent,
} from "@/server/consent/records";
import { createConsentRequest, revokeConsentRequest } from "@/server/consent/requests";
import { createTeam } from "@/server/squad/teams";
import { guardianGrant, namedPlayer } from "./helpers/consent";
import { fixtures } from "./helpers/fixtures";

// NFR16 for the two C05 tables: Consent and ConsentRequest are tenant-scoped.

vi.mock("@/server/consent/jobs", () => ({ enqueueConsentWithdrawn: vi.fn(async () => {}) }));

const f = fixtures();
let ctxA: AuthContext;
let ctxB: AuthContext;
let orgA: string;
let orgB: string;
let playerA: string;
let playerB: string;

beforeAll(async () => {
  const a = await f.org("Consent tenant A");
  const b = await f.org("Consent tenant B");
  orgA = a.id;
  orgB = b.id;
  const ownerA = await f.user("Tenant Owner A");
  const ownerB = await f.user("Tenant Owner B");
  await f.member(a.id, ownerA.id, "owner");
  await f.member(b.id, ownerB.id, "owner");
  ctxA = await f.ctx(ownerA, a.id);
  ctxB = await f.ctx(ownerB, b.id);
  const teamA = await createTeam(ctxA, { name: "U14", season: "2026" });
  const teamB = await createTeam(ctxB, { name: "U14", season: "2026" });
  playerA = (await namedPlayer(ctxA, teamA.id)).id;
  playerB = (await namedPlayer(ctxB, teamB.id)).id;
  await recordConsent(ctxA, playerA, guardianGrant());
  await createConsentRequest(ctxA, playerA);
});

afterAll(async () => {
  await f.cleanup();
});

const errorOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e as Error,
  );

describe("org B's scoped client and org A's consent", () => {
  it("cannot read or count org A's Consent or ConsentRequest rows", async () => {
    expect(await ctxB.db.consent.findMany({ where: { playerId: playerA } })).toEqual([]);
    expect(await ctxB.db.consent.count({ where: { playerId: playerA } })).toBe(0);
    expect(await ctxB.db.consentRequest.findMany({ where: { playerId: playerA } })).toEqual([]);
    expect(await ctxB.db.consentRequest.count()).toBe(0);
    expect(await ctxA.db.consent.count({ where: { playerId: playerA } })).toBeGreaterThan(0);
  });

  it("cannot insert a Consent row naming org A", async () => {
    const err = await errorOf(
      ctxB.db.consent.create({
        data: {
          organisationId: orgA,
          playerId: playerA,
          state: "withdrawn",
          clubStats: false,
          scoutVisible: false,
          playerWasMinor: true,
          withdrawnAt: new Date(),
        },
      }),
    );
    expect(err?.name).toBe("TenantScopeError");
  });

  it("gets P2003 from the composite foreign key for org A's playerId", async () => {
    const consent = await errorOf(
      ctxB.db.consent.create({
        data: {
          organisationId: orgB,
          playerId: playerA,
          state: "withdrawn",
          clubStats: false,
          scoutVisible: false,
          playerWasMinor: true,
          withdrawnAt: new Date(),
        },
      }),
    );
    expect(prismaErrorCode(consent)).toBe("P2003");
    const request = await errorOf(
      ctxB.db.consentRequest.create({
        data: {
          organisationId: orgB,
          playerId: playerA,
          tokenHash: `cross-${Date.now()}`,
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    );
    expect(prismaErrorCode(request)).toBe("P2003");
    expect((await rawDb.player.findUniqueOrThrow({ where: { id: playerA } })).consentState).toBe(
      "scout_visible",
    );
  });

  it("gets not_found from every service for org A's player", async () => {
    for (const run of [
      () => consentHistory(ctxB, playerA),
      () => recordConsent(ctxB, playerA, guardianGrant()),
      () => withdrawConsent(ctxB, playerA, { requestedBy: "X", method: "email" }),
      () => createConsentRequest(ctxB, playerA),
      () => revokeConsentRequest(ctxB, playerA),
    ]) {
      const err = await errorOf(run());
      expect(err).toBeInstanceOf(ConsentError);
      expect((err as ConsentError).code).toBe("not_found");
    }
    expect(await consentHistory(ctxB, playerB)).toEqual([]);
  });
});
