import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { ConsentState } from "@/generated/prisma/enums";
import { ZodError } from "zod";
import {
  CONSENT_LINK_DAYS,
  consentDeparted,
  GUARDIAN_EMAIL_REQUIRED,
  isMinorOn,
  playerIsAdult,
} from "@/lib/consent-rules";
import { maskEmail, playerName } from "@/lib/labels";
import type { AuthContext } from "../auth/session";
import { audit } from "../audit";
import { lockConsentState } from "../db/consent";
import { guardianLinkEmail } from "../emails/consent";
import { env } from "../env";
import { log } from "../log";
import { sendMail } from "../mail";
import { requireSquadOrg } from "../squad/access";
import { asTransactionClient } from "../squad/tx";
import { ConsentError } from "./errors";
import { guardianEmailSchema } from "./fields";
import { consentPlayer, type ConsentPlayer } from "./records";

/**
 * Guardian links, club side (CONS02, CONS03; docs/build/design/C05.md, Surface
 * 4). A link is a 256-bit token in /consent/<token>; only its sha256 hash is
 * stored (the invitation pattern, src/server/organisations/tokens.ts). It
 * decides for CONSENT_LINK_DAYS, and withdraws until it is revoked or replaced.
 * One open link per player: a new one revokes the others. The club shares it
 * itself (WhatsApp, SMS, or its own phone), and Wideline also emails it when
 * the club gives the guardian's address (Q-019). The address is stored on the
 * request and is personal data: it never goes into audit metadata or logs. The
 * guardian side is guardian.ts.
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

export type OpenConsentRequest = {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  /** The stored guardian address, masked ("t***@example.com"), or null. Never the full address. */
  emailMasked: string | null;
};

/** The player's open link (not revoked, not expired), if any. */
export async function openConsentRequest(
  ctx: AuthContext,
  playerId: string,
  now = new Date(),
): Promise<OpenConsentRequest | null> {
  requireSquadOrg(ctx);
  const req = await ctx.db.consentRequest.findFirst({
    where: { playerId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, expiresAt: true, guardianEmail: true },
  });
  if (!req) return null;
  const { guardianEmail, ...rest } = req;
  return { ...rest, emailMasked: guardianEmail ? maskEmail(guardianEmail) : null };
}

/**
 * What happened to the email of a link: null when no address was given;
 * otherwise whether it was sent, and the masked address for the club's message.
 */
export type LinkEmailResult = { sent: boolean; masked: string } | null;

/** The guardian address from a form, validated (emailField); undefined when empty. */
function parseGuardianEmail(input: { guardianEmail?: string | null }): string | undefined {
  try {
    return guardianEmailSchema.parse({ guardianEmail: input.guardianEmail ?? undefined })
      .guardianEmail;
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ConsentError("invalid", err.issues[0]?.message, "guardianEmail");
    }
    throw err;
  }
}

/** A current, named player under 18 (or with no date of birth): who a link may be for. */
function assertLinkable(player: ConsentPlayer, now: Date): string {
  if (player.isPlaceholder || player.isOpposition) throw new ConsentError("placeholder");
  const first = player.firstName ?? playerName(player);
  if (player.clubStatus === "departed") {
    throw new ConsentError("departed", consentDeparted(first));
  }
  if (!isMinorOn(player.dateOfBirth, now)) {
    throw new ConsentError("adult", playerIsAdult(first));
  }
  return first;
}

/**
 * Emails the link to the guardian, then audits consent.request_emailed with ids
 * and flags only. A send failure is logged without the error message (an SMTP
 * error can repeat the address) and returns sent: false: the link stays, and
 * the club copies it instead.
 */
async function emailLink(
  ctx: AuthContext,
  {
    playerId,
    requestId,
    firstName,
    to,
    url,
    expiresAt,
    resend,
  }: {
    playerId: string;
    requestId: string;
    firstName: string;
    to: string;
    url: string;
    expiresAt: Date;
    resend: boolean;
  },
): Promise<{ sent: boolean; masked: string }> {
  const { subject, text, html } = guardianLinkEmail({
    clubName: ctx.organisationName,
    firstName,
    url,
    expiresAt,
  });
  let sent = true;
  try {
    await sendMail(to, subject, text, html);
  } catch (err) {
    sent = false;
    const e = err as { name?: unknown; code?: unknown; responseCode?: unknown };
    log.error(
      {
        organisationId: ctx.organisationId,
        requestId,
        errName: typeof e?.name === "string" ? e.name : undefined,
        errCode: typeof e?.code === "string" ? e.code : undefined,
        responseCode: typeof e?.responseCode === "number" ? e.responseCode : undefined,
      },
      "consent link email failed",
    );
  }
  await audit({
    organisationId: ctx.organisationId,
    actorUserId: ctx.user.id,
    action: "consent.request_emailed",
    targetType: "Player",
    targetId: playerId,
    metadata: { requestId, resend, emailed: sent },
  });
  return { sent, masked: maskEmail(to) };
}

/**
 * Creates a guardian link for a current, named player under 18 (or with no
 * date of birth). Revokes every earlier link for the player. Writes a
 * "requested" row only when the state is none or withdrawn: a pending or
 * granted state stays as it is. Audited as consent.request. Returns the raw URL
 * once; it is never stored or logged.
 *
 * With a guardian email (optional, Q-019), the address is stored on the request
 * and the link is emailed after the transaction commits, so a failed send never
 * loses the link: `email.sent` is false and the club copies the link instead.
 */
export async function createConsentRequest(
  ctx: AuthContext,
  playerId: string,
  now = new Date(),
  input: { guardianEmail?: string | null } = {},
): Promise<{
  url: string;
  requestId: string;
  expiresAt: Date;
  state: ConsentState;
  email: LinkEmailResult;
}> {
  requireSquadOrg(ctx);
  const guardianEmail = parseGuardianEmail(input);
  const player = await consentPlayer(ctx, playerId);
  assertLinkable(player, now);
  const { token, tokenHash } = newConsentToken();
  const expiresAt = new Date(now.getTime() + LINK_TTL_MS);

  const result = await ctx.db.$transaction(async (tx) => {
    const from = await lockConsentState(tx, ctx.organisationId, playerId);
    if (from === null) throw new ConsentError("not_found");
    const revoked = await tx.consentRequest.updateMany({
      where: { playerId, revokedAt: null },
      // A closed link no longer needs the guardian's address (data minimisation).
      data: { revokedAt: now, guardianEmail: null },
    });
    const request = await tx.consentRequest.create({
      data: {
        organisationId: ctx.organisationId,
        playerId,
        tokenHash,
        createdById: ctx.user.id,
        expiresAt,
        guardianEmail: guardianEmail ?? null,
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
          withEmail: guardianEmail !== undefined,
        },
      },
      asTransactionClient(tx),
    );
    return { requestId: request.id, state };
  });
  const url = consentLinkUrl(env().APP_URL, token);
  const email = guardianEmail
    ? await emailLink(ctx, {
        playerId,
        requestId: result.requestId,
        firstName: player.firstName ?? "your child",
        to: guardianEmail,
        url,
        expiresAt,
        resend: false,
      })
    : null;
  return { url, expiresAt, ...result, email };
}

/**
 * "Email the link again" (Q-019): emails the open link to the stored address,
 * or to a new one (which is then stored). Only the token's hash is kept, so the
 * link cannot be sent as it was: the open request gets a fresh token, its
 * expiry stays, and the earlier URL stops working. The new URL is returned once
 * for the copy box, so a failed send still leaves the club a working link.
 * The token change is audited as consent.request_reissue in its transaction;
 * the send as consent.request_emailed (ids and flags only). Throws
 * ConsentError("no_link") when no link is open.
 */
export async function emailConsentRequest(
  ctx: AuthContext,
  playerId: string,
  input: { guardianEmail?: string | null } = {},
  now = new Date(),
): Promise<{
  url: string;
  requestId: string;
  expiresAt: Date;
  email: { sent: boolean; masked: string };
}> {
  requireSquadOrg(ctx);
  const newAddress = parseGuardianEmail(input);
  const player = await consentPlayer(ctx, playerId);
  assertLinkable(player, now);
  const { token, tokenHash } = newConsentToken();

  const { requestId, expiresAt, to } = await ctx.db.$transaction(async (tx) => {
    const from = await lockConsentState(tx, ctx.organisationId, playerId);
    if (from === null) throw new ConsentError("not_found");
    const open = await tx.consentRequest.findFirst({
      where: { playerId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      select: { id: true, expiresAt: true, guardianEmail: true },
    });
    if (!open) throw new ConsentError("no_link");
    const to = newAddress ?? open.guardianEmail;
    if (!to) throw new ConsentError("invalid", GUARDIAN_EMAIL_REQUIRED, "guardianEmail");
    const changed = await tx.consentRequest.updateMany({
      where: { id: open.id, revokedAt: null },
      data: { tokenHash, guardianEmail: to },
    });
    if (changed.count === 0) throw new ConsentError("no_link");
    await audit(
      {
        organisationId: ctx.organisationId,
        actorUserId: ctx.user.id,
        action: "consent.request_reissue",
        targetType: "Player",
        targetId: playerId,
        metadata: {
          requestId: open.id,
          newAddress: newAddress !== undefined && newAddress !== open.guardianEmail,
        },
      },
      asTransactionClient(tx),
    );
    return { requestId: open.id, expiresAt: open.expiresAt, to };
  });

  const url = consentLinkUrl(env().APP_URL, token);
  const email = await emailLink(ctx, {
    playerId,
    requestId,
    firstName: player.firstName ?? "your child",
    to,
    url,
    expiresAt,
    resend: true,
  });
  return { url, requestId, expiresAt, email };
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
      // A closed link no longer needs the guardian's address (data minimisation).
      data: { revokedAt: now, guardianEmail: null },
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
