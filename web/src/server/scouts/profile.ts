import "server-only";
import type { ScoutAffiliationType } from "@/generated/prisma/enums";
import { audit } from "../audit";
import { rawDb } from "../db/raw";
import { releaseConflictedClaims } from "../review/lifecycle";
import { coolingOffSince } from "./conflicts";
import {
  affiliationSchema,
  MAX_AFFILIATIONS_PER_TYPE,
  phoneField,
  type AffiliationInput,
} from "./fields";
import { REVIEWER_TERMS_VERSION } from "./terms";

/**
 * The scout's own profile (AUTH09, AUTH10). Every export takes the caller's
 * own session userId (ctx.user.id after requireRole), never an id from a form,
 * so a scout can only ever read or change their own profile.
 */

export type ScoutProfileErrorCode =
  "no_profile" | "duplicate" | "limit" | "cooling_off_limit" | "already_removed" | "terms_changed";

export class ScoutProfileError extends Error {
  constructor(readonly code: ScoutProfileErrorCode) {
    super(`Scout profile: ${code}`);
    this.name = "ScoutProfileError";
  }
}

export type OwnAffiliation = {
  id: string;
  type: ScoutAffiliationType;
  name: string;
  clubName: string | null;
  linked: boolean;
  declaredAt: Date;
};

export type OwnScoutProfile = {
  id: string;
  status: "pending" | "approved" | "rejected" | "suspended";
  idDocumentType: "sa_id" | "passport";
  idCountry: string;
  phone: string;
  termsAcceptedAt: Date;
  termsVersion: string;
  termsCurrent: boolean;
  verifiedAt: Date | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  suspendedAt: Date | null;
  suspensionReason: string | null;
  createdAt: Date;
  user: { name: string; email: string; emailVerified: boolean };
  /** Active rows only, oldest first. Removed rows are kept but never shown to the scout. */
  affiliations: OwnAffiliation[];
};

/** The caller's profile with active affiliations, or null when they have none. No hash. */
export async function getOwnScoutProfile(userId: string): Promise<OwnScoutProfile | null> {
  const p = await rawDb.scoutProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      status: true,
      idDocumentType: true,
      idCountry: true,
      phone: true,
      termsAcceptedAt: true,
      termsVersion: true,
      verifiedAt: true,
      reviewedAt: true,
      rejectionReason: true,
      suspendedAt: true,
      suspensionReason: true,
      createdAt: true,
      user: { select: { name: true, email: true, emailVerified: true } },
      affiliations: {
        where: { removedAt: null },
        orderBy: { declaredAt: "asc" },
        select: {
          id: true,
          type: true,
          name: true,
          clubName: true,
          organisationId: true,
          declaredAt: true,
        },
      },
    },
  });
  if (!p) return null;
  return {
    ...p,
    termsCurrent: p.termsVersion === REVIEWER_TERMS_VERSION,
    affiliations: p.affiliations.map(({ organisationId, ...a }) => ({
      ...a,
      linked: organisationId !== null,
    })),
  };
}

async function profileIdOf(userId: string): Promise<string> {
  const p = await rawDb.scoutProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!p) throw new ScoutProfileError("no_profile");
  return p.id;
}

/** Saves a new phone number. Unchanged writes nothing and audits nothing. */
export async function updateOwnPhone(
  userId: string,
  phone: string,
): Promise<{ changed: boolean; phone: string }> {
  const next = phoneField.parse(phone);
  const p = await rawDb.scoutProfile.findUnique({
    where: { userId },
    select: { id: true, phone: true },
  });
  if (!p) throw new ScoutProfileError("no_profile");
  if (p.phone === next) return { changed: false, phone: next };
  await rawDb.scoutProfile.update({ where: { id: p.id }, data: { phone: next } });
  await audit({
    organisationId: null,
    actorUserId: userId,
    action: "scout.phone_changed",
    targetType: "ScoutProfile",
    targetId: p.id,
  });
  return { changed: true, phone: next };
}

/**
 * Declares a club or a represented player. Refuses a name already on the
 * active list (same type, case-insensitive) and more than 30 per type. A
 * represented player blocks claims whatever the lineup player's consent
 * (REVIEW02, Q-053), so declaring names is a way to probe which matches a
 * child plays in. To bound that, at most 30 player names may block at once,
 * counting removed ones still in their 90-day cooling-off (Q-006):
 * cooling_off_limit. Every declaration is audited without the name.
 */
export async function addOwnAffiliation(
  userId: string,
  input: AffiliationInput,
): Promise<{ id: string; name: string }> {
  const data = affiliationSchema.parse(input);
  await profileIdOf(userId);
  const row = await rawDb.$transaction(async (tx) => {
    const active = await tx.scoutAffiliation.findMany({
      where: { scoutUserId: userId, type: data.type, removedAt: null },
      select: { name: true },
    });
    if (active.some((a) => a.name.toLowerCase() === data.name.toLowerCase())) {
      throw new ScoutProfileError("duplicate");
    }
    if (active.length >= MAX_AFFILIATIONS_PER_TYPE) throw new ScoutProfileError("limit");
    if (data.type === "player") {
      const cooling = await tx.scoutAffiliation.count({
        where: {
          scoutUserId: userId,
          type: "player",
          removedAt: { gt: coolingOffSince(new Date()) },
        },
      });
      if (active.length + cooling >= MAX_AFFILIATIONS_PER_TYPE) {
        throw new ScoutProfileError("cooling_off_limit");
      }
    }
    const created = await tx.scoutAffiliation.create({
      data: {
        scoutUserId: userId,
        type: data.type,
        name: data.name,
        clubName: data.type === "player" ? data.clubName : null,
      },
    });
    // C10 (A-9): a new affiliation releases the claims it conflicts with, in
    // this transaction, so it sees the new row. Removal releases nothing: the
    // removed row keeps blocking for 90 days (Q-006).
    await releaseConflictedClaims(tx, userId, new Date(), userId);
    return created;
  });
  await audit({
    organisationId: null,
    actorUserId: userId,
    action: "scout.affiliation_added",
    targetType: "ScoutAffiliation",
    targetId: row.id,
    // The id (targetId) and type only: a represented player's name is a child's
    // name in free text, and the AuditLog is append-only. The row keeps the name.
    metadata: { type: row.type },
  });
  return { id: row.id, name: row.name };
}

/** Soft-deletes one of the caller's own active affiliations (removedAt is kept). */
export async function removeOwnAffiliation(
  userId: string,
  affiliationId: string,
): Promise<{ name: string }> {
  const row = await rawDb.scoutAffiliation.findFirst({
    where: { id: affiliationId, scoutUserId: userId },
    select: { id: true, name: true, type: true },
  });
  if (!row) throw new ScoutProfileError("already_removed");
  const { count } = await rawDb.scoutAffiliation.updateMany({
    where: { id: affiliationId, scoutUserId: userId, removedAt: null },
    data: { removedAt: new Date() },
  });
  if (count !== 1) throw new ScoutProfileError("already_removed");
  await audit({
    organisationId: null,
    actorUserId: userId,
    action: "scout.affiliation_removed",
    targetType: "ScoutAffiliation",
    targetId: row.id,
    // No name: see addOwnAffiliation.
    metadata: { type: row.type },
  });
  return { name: row.name };
}

/**
 * Accepts the terms version the scout read. Refuses with terms_changed when
 * that is no longer the current version, so nobody accepts text they did not see.
 */
export async function acceptCurrentTerms(userId: string, version: string): Promise<void> {
  if (version !== REVIEWER_TERMS_VERSION) throw new ScoutProfileError("terms_changed");
  const id = await profileIdOf(userId);
  await rawDb.scoutProfile.update({
    where: { id },
    data: { termsAcceptedAt: new Date(), termsVersion: REVIEWER_TERMS_VERSION },
  });
  await audit({
    organisationId: null,
    actorUserId: userId,
    action: "scout.terms_accepted",
    targetType: "ScoutProfile",
    targetId: id,
    metadata: { termsVersion: REVIEWER_TERMS_VERSION },
  });
}
