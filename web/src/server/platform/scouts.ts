import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { IdDocumentType, ScoutAffiliationType, ScoutStatus } from "@/generated/prisma/enums";
import type { AuthContext } from "../auth/session";
import { audit } from "../audit";
import { rawDb } from "../db/raw";
import {
  scoutApprovedEmail,
  scoutReinstatedEmail,
  scoutRejectedEmail,
  scoutSuspendedEmail,
} from "../emails/scout";
import type { Email } from "../emails/organisation";
import { env } from "../env";
import { log } from "../log";
import { sendMail } from "../mail";
import {
  LINKABLE_TYPES,
  matchName,
  nameKey,
  organisationsByName,
  type LinkableOrganisation,
} from "../scouts/conflicts";
import { releaseClaimsForScout, releaseConflictedClaims } from "../review/lifecycle";
import { REVIEWER_TERMS_VERSION } from "../scouts/terms";
import { assertPlatformAdmin } from "./assert";
import { rejectionReasonField } from "./organisations";

/**
 * Platform operations on scouts (AUTH08, ADMIN01, ADMIN06). They read and
 * write the global scout tables, so they use the raw client, and every export
 * takes a platform_admin AuthContext and checks it again here. Each decision
 * is one guarded updateMany (the status it starts from is in the where), so
 * two admins deciding at once give one success and one refusal. Each decision
 * and its AuditLog row (with the actor) are written in one transaction, so a
 * decision is never committed unaudited (NFR20). The email goes after the
 * commit; a failed email is logged and reported as emailSent false (in the
 * return value only), and the decision stands. Audit metadata never holds a
 * declared club or player name: those are children's names in free text, and
 * the AuditLog is append-only. The ID number hash is never read here.
 */

export type ScoutDecisionErrorCode =
  | "not_found"
  | "not_pending"
  | "not_approved"
  | "not_suspended"
  | "email_unconfirmed"
  | "affiliation_removed"
  | "org_inactive";

export class ScoutDecisionError extends Error {
  constructor(readonly code: ScoutDecisionErrorCode) {
    super(`Scout decision refused: ${code}`);
    this.name = "ScoutDecisionError";
  }
}

export type { LinkableOrganisation };

export type ScoutAffiliationRow = {
  id: string;
  type: ScoutAffiliationType;
  name: string;
  clubName: string | null;
  organisationId: string | null;
  organisationName: string | null;
  /**
   * An admin checked the row: it is linked, or they saved "Not matched". An
   * unchecked row is new to the admins (declared at registration or added on
   * /scout since).
   */
  checked: boolean;
  /**
   * For an unlinked row: an active organisation whose name matches (club name,
   * or the player's club). scoutConflicts counts every such organisation.
   */
  suggestion: LinkableOrganisation | null;
};

export type ScoutRow = {
  id: string;
  userId: string;
  status: ScoutStatus;
  name: string;
  email: string;
  emailVerified: boolean;
  phone: string;
  idDocumentType: IdDocumentType;
  idCountry: string;
  createdAt: Date;
  verifiedAt: Date | null;
  reviewedAt: Date | null;
  suspendedAt: Date | null;
  rejectionReason: string | null;
  suspensionReason: string | null;
  termsVersion: string;
  termsCurrent: boolean;
  affiliations: ScoutAffiliationRow[];
};

/** Active academies, clubs and agencies, by name: the options for linking an affiliation. */
export async function listLinkableOrganisations(ctx: AuthContext): Promise<LinkableOrganisation[]> {
  assertPlatformAdmin(ctx);
  return rawDb.organisation.findMany({
    where: { status: "active", type: { in: LINKABLE_TYPES } },
    select: { id: true, name: true, type: true },
    orderBy: { name: "asc" },
  });
}

const ORDER: Record<ScoutStatus, object> = {
  pending: { createdAt: "asc" },
  approved: { verifiedAt: "desc" },
  suspended: { suspendedAt: "desc" },
  rejected: { reviewedAt: "desc" },
};

/** An active affiliation no admin has checked yet: neither linked nor marked Not matched. */
const UNCHECKED_AFFILIATION = { removedAt: null, organisationId: null, linkedAt: null };

/**
 * Scouts in one status: pending oldest first, the others newest decision
 * first. Each row has the user's name, email and email state, the profile
 * without the hash, and the active affiliations with a possible match.
 * `unchecked` keeps only scouts with an affiliation no admin has checked.
 */
export async function listScouts(
  ctx: AuthContext,
  { status, unchecked = false }: { status: ScoutStatus; unchecked?: boolean },
): Promise<ScoutRow[]> {
  assertPlatformAdmin(ctx);
  const [rows, organisations] = await Promise.all([
    rawDb.scoutProfile.findMany({
      where: { status, ...(unchecked && { affiliations: { some: UNCHECKED_AFFILIATION } }) },
      orderBy: [ORDER[status], { createdAt: "asc" }],
      select: {
        id: true,
        userId: true,
        status: true,
        phone: true,
        idDocumentType: true,
        idCountry: true,
        createdAt: true,
        verifiedAt: true,
        reviewedAt: true,
        suspendedAt: true,
        rejectionReason: true,
        suspensionReason: true,
        termsVersion: true,
        user: { select: { name: true, email: true, emailVerified: true } },
        affiliations: {
          where: { removedAt: null },
          orderBy: [{ type: "asc" }, { declaredAt: "asc" }],
          select: {
            id: true,
            type: true,
            name: true,
            clubName: true,
            organisationId: true,
            linkedAt: true,
            organisation: { select: { name: true } },
          },
        },
      },
    }),
    listLinkableOrganisations(ctx),
  ]);
  const byName = new Map<string, LinkableOrganisation>();
  for (const o of organisations) {
    const key = nameKey(o.name);
    if (!byName.has(key)) byName.set(key, o);
  }
  const suggest = (name: string | null) => (name ? (byName.get(nameKey(name)) ?? null) : null);

  return rows.map(({ user, affiliations, ...r }) => ({
    ...r,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    termsCurrent: r.termsVersion === REVIEWER_TERMS_VERSION,
    affiliations: affiliations.map(({ organisation, linkedAt, ...a }) => ({
      ...a,
      organisationName: organisation?.name ?? null,
      checked: linkedAt !== null,
      suggestion: a.organisationId ? null : suggest(matchName(a)),
    })),
  }));
}

export async function countPendingScouts(ctx: AuthContext): Promise<number> {
  assertPlatformAdmin(ctx);
  return rawDb.scoutProfile.count({ where: { status: "pending" } });
}

/** Scouts in one status with an affiliation no admin has checked yet. */
export async function countScoutsWithUnchecked(
  ctx: AuthContext,
  { status }: { status: ScoutStatus },
): Promise<number> {
  assertPlatformAdmin(ctx);
  return rawDb.scoutProfile.count({
    where: { status, affiliations: { some: UNCHECKED_AFFILIATION } },
  });
}

export type ScoutDecision = { name: string; email: string; emailSent: boolean };

async function loadProfile(id: string) {
  const p = await rawDb.scoutProfile.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      status: true,
      termsVersion: true,
      user: { select: { name: true, email: true, emailVerified: true } },
    },
  });
  if (!p) throw new ScoutDecisionError("not_found");
  return p;
}

async function send(to: string, { subject, text }: Email, profileId: string, what: string) {
  try {
    await sendMail(to, subject, text);
    return true;
  } catch (err) {
    log.error({ err, profileId }, `scout ${what} email failed`);
    return false;
  }
}

/** Writes the decision's AuditLog row in tx; a failure throws and rolls the decision back. */
async function auditDecision(
  tx: Prisma.TransactionClient,
  ctx: AuthContext,
  action: string,
  profile: { id: string; userId: string },
  metadata: Record<string, string | null> = {},
) {
  await audit(
    {
      organisationId: null,
      actorUserId: ctx.user.id,
      action,
      targetType: "ScoutProfile",
      targetId: profile.id,
      metadata: { scoutUserId: profile.userId, ...metadata },
    },
    tx,
  );
}

/**
 * Approves a pending scout. Needs a confirmed email (Better Auth email
 * verification): the admin judges identity from name, phone, email and
 * affiliations, so the email must be real. Sets verifiedAt, then links every
 * unchecked affiliation whose name matches exactly one active organisation
 * (autoLinkAffiliations), in the same transaction as the approval and its
 * audit row. Rows with no match, or several, stay unchecked; scoutConflicts
 * counts name matches either way.
 */
export async function approveScout(ctx: AuthContext, id: string): Promise<ScoutDecision> {
  assertPlatformAdmin(ctx);
  const p = await loadProfile(id);
  if (p.status !== "pending") throw new ScoutDecisionError("not_pending");
  if (!p.user.emailVerified) throw new ScoutDecisionError("email_unconfirmed");
  const now = new Date();
  const approved = await rawDb.$transaction(async (tx) => {
    const { count } = await tx.scoutProfile.updateMany({
      where: { id, status: "pending", user: { is: { emailVerified: true } } },
      data: { status: "approved", verifiedAt: now, reviewedAt: now, reviewedById: ctx.user.id },
    });
    if (count !== 1) return false;
    await auditDecision(tx, ctx, "scout.approved", p);
    await linkMatches(tx, ctx, p.userId);
    return true;
  });
  if (!approved) {
    const fresh = await loadProfile(id);
    throw new ScoutDecisionError(fresh.status !== "pending" ? "not_pending" : "email_unconfirmed");
  }
  const emailSent = await send(
    p.user.email,
    scoutApprovedEmail({ name: p.user.name, appUrl: env().APP_URL }),
    id,
    "approval",
  );
  return { name: p.user.name, email: p.user.email, emailSent };
}

/** Rejects a pending scout, with an optional reason (500 characters or fewer) for the email. */
export async function rejectScout(
  ctx: AuthContext,
  id: string,
  reason?: string | null,
): Promise<ScoutDecision> {
  assertPlatformAdmin(ctx);
  const rejectionReason = rejectionReasonField.parse(reason ?? undefined);
  const p = await loadProfile(id);
  await rawDb.$transaction(async (tx) => {
    const { count } = await tx.scoutProfile.updateMany({
      where: { id, status: "pending" },
      data: {
        status: "rejected",
        rejectionReason,
        reviewedAt: new Date(),
        reviewedById: ctx.user.id,
      },
    });
    if (count !== 1) throw new ScoutDecisionError("not_pending");
    await auditDecision(tx, ctx, "scout.rejected", p, { reason: rejectionReason });
  });
  const emailSent = await send(
    p.user.email,
    scoutRejectedEmail({ name: p.user.name, reason: rejectionReason }),
    id,
    "rejection",
  );
  return { name: p.user.name, email: p.user.email, emailSent };
}

export const SUSPENSION_REASON_REQUIRED = "Enter a reason for the suspension.";

export const suspensionReasonField = z
  .string({ error: SUSPENSION_REASON_REQUIRED })
  .trim()
  .min(1, { error: SUSPENSION_REASON_REQUIRED })
  .max(500, { error: "Use 500 characters or fewer." });

/**
 * Suspends an approved scout's review access (ADMIN06). requireReviewer reads
 * the status on every request, so access ends on the scout's next request.
 * Their open review claims are released in the same transaction (C10, reason
 * suspended), so the matches go back to the queue at once.
 */
export async function suspendScout(
  ctx: AuthContext,
  id: string,
  reason: string,
): Promise<ScoutDecision> {
  assertPlatformAdmin(ctx);
  const suspensionReason = suspensionReasonField.parse(reason);
  const p = await loadProfile(id);
  await rawDb.$transaction(async (tx) => {
    const now = new Date();
    const { count } = await tx.scoutProfile.updateMany({
      where: { id, status: "approved" },
      data: { status: "suspended", suspendedAt: now, suspensionReason },
    });
    if (count !== 1) throw new ScoutDecisionError("not_approved");
    await auditDecision(tx, ctx, "scout.suspended", p, { reason: suspensionReason });
    await releaseClaimsForScout(tx, p.userId, "suspended", now, ctx.user.id);
  });
  const emailSent = await send(
    p.user.email,
    scoutSuspendedEmail({ name: p.user.name, reason: suspensionReason }),
    id,
    "suspension",
  );
  return { name: p.user.name, email: p.user.email, emailSent };
}

/** Reinstates a suspended scout to approved. Review still needs the current terms. */
export async function reinstateScout(ctx: AuthContext, id: string): Promise<ScoutDecision> {
  assertPlatformAdmin(ctx);
  const p = await loadProfile(id);
  await rawDb.$transaction(async (tx) => {
    const { count } = await tx.scoutProfile.updateMany({
      where: { id, status: "suspended" },
      data: { status: "approved", suspendedAt: null, suspensionReason: null },
    });
    if (count !== 1) throw new ScoutDecisionError("not_suspended");
    await auditDecision(tx, ctx, "scout.reinstated", p);
  });
  const emailSent = await send(
    p.user.email,
    scoutReinstatedEmail({
      name: p.user.name,
      appUrl: env().APP_URL,
      termsStale: p.termsVersion !== REVIEWER_TERMS_VERSION,
    }),
    id,
    "reinstatement",
  );
  return { name: p.user.name, email: p.user.email, emailSent };
}

/**
 * Links each unchecked active affiliation of a scout whose name (a club's
 * name, a player's club) equals exactly one active academy, club or agency,
 * case-insensitively, the match the admin page suggests. Each link is audited
 * as scout.affiliation_linked with automatic: true, in the same transaction as
 * the link. Returns how many it linked.
 */
export async function autoLinkAffiliations(ctx: AuthContext, scoutUserId: string): Promise<number> {
  assertPlatformAdmin(ctx);
  return rawDb.$transaction((tx) => linkMatches(tx, ctx, scoutUserId));
}

/** autoLinkAffiliations inside the caller's transaction (approveScout's, or its own). */
async function linkMatches(
  tx: Prisma.TransactionClient,
  ctx: AuthContext,
  scoutUserId: string,
): Promise<number> {
  const rows = await tx.scoutAffiliation.findMany({
    where: { scoutUserId, ...UNCHECKED_AFFILIATION },
    select: { id: true, type: true, name: true, clubName: true },
  });
  const byName = await organisationsByName(rows.map(matchName).filter((n) => n !== null));
  let linked = 0;
  for (const row of rows) {
    const name = matchName(row);
    const matches = name ? (byName.get(nameKey(name)) ?? []) : [];
    if (matches.length !== 1) continue;
    const org = matches[0]!;
    const { count } = await tx.scoutAffiliation.updateMany({
      where: { id: row.id, ...UNCHECKED_AFFILIATION },
      data: { organisationId: org.id, linkedAt: new Date(), linkedById: ctx.user.id },
    });
    if (count !== 1) continue;
    linked++;
    await audit(
      {
        organisationId: null,
        actorUserId: ctx.user.id,
        action: "scout.affiliation_linked",
        targetType: "ScoutAffiliation",
        targetId: row.id,
        metadata: {
          scoutUserId,
          type: row.type,
          linkedOrganisationId: org.id,
          previousOrganisationId: null,
          automatic: true,
        },
      },
      tx,
    );
  }
  // C10 (A-9): a newly linked affiliation releases the claims it conflicts with.
  if (linked > 0) await releaseConflictedClaims(tx, scoutUserId, new Date(), ctx.user.id);
  return linked;
}

export type AffiliationLink = { name: string; organisationName: string | null };

/**
 * Links a declared affiliation to an active academy, club or agency, or marks
 * it Not matched (organisationId null). Either way the row is checked
 * (linkedAt, linkedById: who checked it and when). A Not matched row whose
 * name equals an organisation's still counts in scoutConflicts: a same-named
 * club is treated as the same club.
 */
export async function linkAffiliation(
  ctx: AuthContext,
  affiliationId: string,
  organisationId: string | null,
): Promise<AffiliationLink> {
  assertPlatformAdmin(ctx);
  let organisationName: string | null = null;
  if (organisationId) {
    const org = await rawDb.organisation.findFirst({
      where: { id: organisationId, status: "active", type: { in: LINKABLE_TYPES } },
      select: { name: true },
    });
    if (!org) throw new ScoutDecisionError("org_inactive");
    organisationName = org.name;
  }
  const row = await rawDb.scoutAffiliation.findUnique({
    where: { id: affiliationId },
    select: { id: true, type: true, name: true, organisationId: true, scoutUserId: true },
  });
  if (!row) throw new ScoutDecisionError("affiliation_removed");
  await rawDb.$transaction(async (tx) => {
    const { count } = await tx.scoutAffiliation.updateMany({
      where: { id: affiliationId, removedAt: null },
      data: { organisationId, linkedAt: new Date(), linkedById: ctx.user.id },
    });
    if (count !== 1) throw new ScoutDecisionError("affiliation_removed");
    await audit(
      {
        organisationId: null,
        actorUserId: ctx.user.id,
        action: "scout.affiliation_linked",
        targetType: "ScoutAffiliation",
        targetId: row.id,
        metadata: {
          scoutUserId: row.scoutUserId,
          type: row.type,
          linkedOrganisationId: organisationId,
          previousOrganisationId: row.organisationId,
        },
      },
      tx,
    );
    // C10 (A-9): the link may conflict with a match the scout holds.
    await releaseConflictedClaims(tx, row.scoutUserId, new Date(), ctx.user.id);
  });
  return { name: row.name, organisationName };
}
