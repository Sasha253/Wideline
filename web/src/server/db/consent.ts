import "server-only";
import type { ClubStatus, ConsentState } from "@/generated/prisma/enums";
import { rawDb } from "./raw";

/**
 * The raw SQL and unscoped reads of the consent module (C05). Everything else
 * in src/server/consent/ goes through a scoped client.
 */

/** The one raw query a transaction client needs: $queryRaw, not tenant-scoped. */
type RawQuery = { $queryRaw: typeof rawDb.$queryRaw };

/**
 * Locks the player row for the rest of the transaction and returns its current
 * consent state, so a change is decided on the state it replaces (two
 * withdrawals at once: the second sees withdrawn). Filters by organisationId by
 * hand: raw SQL is not scoped. Null when the player is not in this organisation.
 */
export async function lockConsentState(
  tx: RawQuery,
  organisationId: string,
  playerId: string,
): Promise<ConsentState | null> {
  return (await lockConsentPlayer(tx, organisationId, playerId))?.consentState ?? null;
}

export type LockedConsentPlayer = {
  consentState: ConsentState;
  dateOfBirth: Date | null;
  clubStatus: ClubStatus;
};

/**
 * lockConsentState, plus the date of birth and club status read under the same
 * lock. Whether a guardian must decide hangs on the date of birth (CONS02), and
 * whether a link may decide on both, so a consent change and a date of birth
 * edit or a departure of one player run one after the other and each sees the
 * other's result. Null when the player is not in this organisation.
 */
export async function lockConsentPlayer(
  tx: RawQuery,
  organisationId: string,
  playerId: string,
): Promise<LockedConsentPlayer | null> {
  const rows = await tx.$queryRaw<LockedConsentPlayer[]>`
    SELECT "consentState"::text AS "consentState", "dateOfBirth", "clubStatus"::text AS "clubStatus"
      FROM "Player"
     WHERE "organisationId" = ${organisationId} AND "id" = ${playerId}
     FOR UPDATE`;
  return rows[0] ?? null;
}

export type ConsentRequestLookup = {
  requestId: string;
  organisationId: string;
  playerId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  /** A newer link exists for the same player. */
  superseded: boolean;
};

/**
 * A guardian link by its raw token (/consent/<token>). The only lookup that
 * runs before the organisation is known: the token is the capability. Only the
 * sha256 hash is compared. Everything after this uses scopedDb(organisationId).
 */
export async function findConsentRequestByToken(
  tokenHash: string,
): Promise<ConsentRequestLookup | null> {
  const req = await rawDb.consentRequest.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      organisationId: true,
      playerId: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  if (!req) return null;
  const newer = await rawDb.consentRequest.count({
    where: {
      organisationId: req.organisationId,
      playerId: req.playerId,
      createdAt: { gt: req.createdAt },
    },
  });
  return {
    requestId: req.id,
    organisationId: req.organisationId,
    playerId: req.playerId,
    expiresAt: req.expiresAt,
    revokedAt: req.revokedAt,
    superseded: newer > 0,
  };
}
