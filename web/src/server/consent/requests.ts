import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { ConsentState } from "@/generated/prisma/enums";
import { CONSENT_LINK_DAYS, consentDeparted, isMinorOn, playerIsAdult } from "@/lib/consent-rules";
import { playerName } from "@/lib/labels";
import type { AuthContext } from "../auth/session";
import { audit } from "../audit";
import { lockConsentState } from "../db/consent";
import { env } from "../env";
import { requireSquadOrg } from "../squad/access";
import { asTransactionClient } from "../squad/tx";
import { ConsentError } from "./errors";
import { consentPlayer } from "./records";

/**
 * Guardian links, club side (CONS02, CONS03; docs/build/design/C05.md, Surface
 * 4). A link is a 256-bit token in /consent/<token>; only its sha256 hash is
 * stored (the invitation pattern, src/server/organisations/tokens.ts). It
 * decides for CONSENT_LINK_DAYS, and withdraws until it is revoked or replaced.
 * One open link per player: a new one revokes the others. The club shares it
 * itself (WhatsApp, SMS, or its own phone): email is CONS05 (v1). The guardian
 * side is guardian.ts.
 */

const LINK_TTL_MS = CONSENT_LINK_DAYS * 24 * 60 * 60 * 1000;

/** A new link token and the hash that is stored. */
export function newConsentToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashConsentToken(token) };
}

export function hashConsentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function consentLinkUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/consent/${token}`;
}

export type OpenConsentRequest = { id: string; createdAt: Date; expiresAt: Date };

/** The player's open link (not revoked, not expired), if any. */
export async function openConsentRequest(
  ctx: AuthContext,
  playerId: string,
  now = new Date(),
): Promise<OpenConsentRequest | null> {
  requireSquadOrg(ctx);
  return ctx.db.consentRequest.findFirst({
    where: { playerId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, expiresAt: true },
  });
}

/**
 * Creates a guardian link for a current, named player under 18 (or with no
 * date of birth). Revokes every earlier link for the player. Writes a
 * "requested" row only when the state is none or withdrawn: a pending or
 * granted state stays as it is. Audited as consent.request. Returns the raw URL
 * once; it is never stored or logged.
 */
export async function createConsentRequest(
  ctx: AuthContext,
  playerId: string,
  now = new Date(),
): Promise<{ url: string; requestId: string; expiresAt: Date; state: ConsentState }> {
  requireSquadOrg(ctx);
  const player = await consentPlayer(ctx, playerId);
  if (player.isPlaceholder || player.isOpposition) throw new ConsentError("placeholder");
  const first = player.firstName ?? playerName(player);
  if (player.clubStatus === "departed") {
    throw new ConsentError("departed", consentDeparted(first));
  }
  if (!isMinorOn(player.dateOfBirth, now)) {
    throw new ConsentError("adult", playerIsAdult(first));
  }
  const { token, tokenHash } = newConsentToken();
  const expiresAt = new Date(now.getTime() + LINK_TTL_MS);

  const result = await ctx.db.$transaction(async (tx) => {
    const from = await lockConsentState(tx, ctx.organisationId, playerId);
    if (from === null) throw new ConsentError("not_found");
    const revoked = await tx.consentRequest.updateMany({
      where: { playerId, revokedAt: null },
      data: { revokedAt: now },
    });
    const request = await tx.consentRequest.create({
      data: {
        organisationId: ctx.organisationId,
        playerId,
        tokenHash,
        createdById: ctx.user.id,
        expiresAt,
      },
      select: { id: true },
    });
    let consentId: string | null = null;
    let state = from;
    if (from === "none" || from === "withdrawn") {
      const row = await tx.consent.create({
        data: {
          organisationId: ctx.organisationId,
          playerId,
          state: "requested",
          clubStats: false,
          scoutVisible: false,
          method: "guardian_link",
          playerWasMinor: true,
          requestId: request.id,
          recordedById: ctx.user.id,
        },
        select: { id: true },
      });
      consentId = row.id;
      state = "requested";
    }
    await audit(
      {
        organisationId: ctx.organisationId,
        actorUserId: ctx.user.id,
        action: "consent.request",
        targetType: "Player",
        targetId: playerId,
        metadata: {
          requestId: request.id,
          consentId,
          from,
          to: state,
          revokedEarlier: revoked.count,
          expiresAt: expiresAt.toISOString(),
        },
      },
      asTransactionClient(tx),
    );
    return { requestId: request.id, state };
  });
  return { url: consentLinkUrl(env().APP_URL, token), expiresAt, ...result };
}

/**
 * Turns off the player's link(s) (Surface 4, "Turn off link"). The consent
 * state stays as it is. Audited as consent.request_revoke. Throws
 * ConsentError("no_link") when no link is open.
 */
export async function revokeConsentRequest(
  ctx: AuthContext,
  playerId: string,
  now = new Date(),
): Promise<{ revoked: number }> {
  requireSquadOrg(ctx);
  await consentPlayer(ctx, playerId);
  return ctx.db.$transaction(async (tx) => {
    const open = await tx.consentRequest.findMany({
      where: { playerId, revokedAt: null },
      select: { id: true },
    });
    if (open.length === 0) throw new ConsentError("no_link");
    await tx.consentRequest.updateMany({
      where: { id: { in: open.map((r) => r.id) }, revokedAt: null },
      data: { revokedAt: now },
    });
    await audit(
      {
        organisationId: ctx.organisationId,
        actorUserId: ctx.user.id,
        action: "consent.request_revoke",
        targetType: "Player",
        targetId: playerId,
        metadata: { requestIds: open.map((r) => r.id) },
      },
      asTransactionClient(tx),
    );
    return { revoked: open.length };
  });
}
