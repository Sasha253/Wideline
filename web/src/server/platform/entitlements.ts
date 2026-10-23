import "server-only";
import { z } from "zod";
import type { OrganisationStatus, OrganisationType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { isFeatureKey, isLimitKey, type FeatureKey, type LimitKey } from "@/lib/entitlement-keys";
import type { AuthContext } from "../auth/session";
import { audit } from "../audit";
import { rawDb } from "../db/raw";
import {
  entitlementsFor,
  type EntitlementDetail,
  type OrganisationEntitlements,
} from "../entitlements";
import { limitValue, type StoredLimit } from "../entitlements/resolve";
import { assertPlatformAdmin } from "./assert";

/**
 * Flags and limits for one organisation (ADMIN04, BILL01): the platform admin
 * side of the entitlement layer. Every export takes a platform_admin
 * AuthContext and checks it again here. Each change and its audit row commit in
 * one transaction (NFR20); an unchanged state writes nothing.
 */

export class EntitlementAdminError extends Error {
  constructor(readonly code: "not_found" | "unknown_key") {
    super(`Entitlement admin: ${code}`);
    this.name = "EntitlementAdminError";
  }
}

export const REASON_TOO_LONG = "Use 500 characters or fewer.";

export const entitlementReasonField = z
  .string()
  .trim()
  .max(500, { error: REASON_TOO_LONG })
  .optional()
  .transform((v) => (v ? v : null));

export type SetterInfo = { reason: string | null; updatedAt: Date; setByName: string | null };

export type AdminEntitlement = EntitlementDetail & {
  overrideInfo: SetterInfo | null;
  flagInfo: SetterInfo | null;
};

export type OrganisationEntitlementsView = Omit<OrganisationEntitlements, "entitlements"> & {
  organisation: {
    id: string;
    name: string;
    status: OrganisationStatus;
    type: OrganisationType;
    country: string;
    region: string | null;
  };
  entitlements: AdminEntitlement[];
};

/** The organisation, its plan and every key with its layers, for the flags and limits page. */
export async function getOrganisationEntitlements(
  ctx: AuthContext,
  organisationId: string,
): Promise<OrganisationEntitlementsView> {
  assertPlatformAdmin(ctx);
  const organisation = await rawDb.organisation.findUnique({
    where: { id: organisationId },
    select: { id: true, name: true, status: true, type: true, country: true, region: true },
  });
  if (!organisation) throw new EntitlementAdminError("not_found");
  const resolved = await entitlementsFor(organisationId);

  const setterIds = new Set<string>();
  for (const e of resolved.entitlements) {
    for (const row of [e.override, e.flag]) if (row?.setByUserId) setterIds.add(row.setByUserId);
  }
  const users = setterIds.size
    ? await rawDb.user.findMany({
        where: { id: { in: [...setterIds] } },
        select: { id: true, name: true },
      })
    : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  const info = (row: EntitlementDetail["override"]): SetterInfo | null =>
    row && {
      reason: row.reason,
      updatedAt: row.updatedAt,
      setByName: row.setByUserId ? (names.get(row.setByUserId) ?? null) : null,
    };

  return {
    ...resolved,
    organisation,
    entitlements: resolved.entitlements.map((e) => ({
      ...e,
      overrideInfo: info(e.override),
      flagInfo: info(e.flag),
    })),
  };
}

export type ChangeResult = {
  changed: boolean;
  organisationName: string;
  /** The plan name the organisation resolves against, or null for built-in defaults. */
  planName: string | null;
  /** The key after the change (or unchanged), read back after commit. */
  entitlement: EntitlementDetail;
};

type Tx = Prisma.TransactionClient;

/**
 * Locks the organisation row until commit (SELECT ... FOR UPDATE, no write), so
 * two admins changing one organisation run one after the other and each audit
 * row's "from" is what it replaced.
 */
async function lockOrganisation(tx: Tx, organisationId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Organisation" WHERE "id" = ${organisationId} FOR UPDATE`;
  if (rows.length !== 1) throw new EntitlementAdminError("not_found");
}

async function afterChange(
  organisationId: string,
  key: LimitKey | FeatureKey,
  changed: boolean,
): Promise<ChangeResult> {
  const [org, resolved] = await Promise.all([
    rawDb.organisation.findUnique({ where: { id: organisationId }, select: { name: true } }),
    entitlementsFor(organisationId),
  ]);
  if (!org) throw new EntitlementAdminError("not_found");
  return {
    changed,
    organisationName: org.name,
    planName: resolved.plan?.name ?? null,
    entitlement: resolved.entitlements.find((e) => e.key === key)!,
  };
}

const whereRow = (organisationId: string, key: string, source: "flag" | "override") => ({
  organisationId_key_source: { organisationId, key, source },
});

/** A stored flag value as "on" or "off", or "invalid" when it is not a boolean. */
function flagState(value: unknown): "on" | "off" | "invalid" {
  return value === true ? "on" : value === false ? "off" : "invalid";
}

/**
 * Sets a feature flag on or off for one organisation, or clears it ("default")
 * so the feature follows the plan again. Audited as entitlement.flag_set or
 * entitlement.flag_cleared with { key, from, to, reason }.
 */
export async function setFeatureFlag(
  ctx: AuthContext,
  organisationId: string,
  key: string,
  state: "on" | "off" | "default",
  reason?: string | null,
): Promise<ChangeResult> {
  assertPlatformAdmin(ctx);
  if (!isFeatureKey(key)) throw new EntitlementAdminError("unknown_key");
  const to = z.enum(["on", "off", "default"]).parse(state);
  const note = entitlementReasonField.parse(reason ?? undefined);

  const changed = await rawDb.$transaction(async (tx) => {
    await lockOrganisation(tx, organisationId);
    const row = await tx.entitlement.findUnique({ where: whereRow(organisationId, key, "flag") });
    const from = row ? flagState(row.value) : "default";
    if (from === to) return false;

    if (to === "default") {
      await tx.entitlement.delete({ where: whereRow(organisationId, key, "flag") });
    } else {
      const data = { value: to === "on", reason: note, setByUserId: ctx.user.id };
      await tx.entitlement.upsert({
        where: whereRow(organisationId, key, "flag"),
        create: { organisationId, key, source: "flag", ...data },
        update: data,
      });
    }
    await audit(
      {
        organisationId,
        actorUserId: ctx.user.id,
        action: to === "default" ? "entitlement.flag_cleared" : "entitlement.flag_set",
        targetType: "Organisation",
        targetId: organisationId,
        metadata: { key, from, to, reason: note },
      },
      tx,
    );
    return true;
  });
  return afterChange(organisationId, key, changed);
}

/** A stored override in its audit form: a number, "unlimited", or "invalid". */
function overrideState(value: unknown): StoredLimit | "invalid" {
  const parsed = limitValue.safeParse(value);
  return parsed.success ? parsed.data : "invalid";
}

/**
 * Sets a limit override for one organisation: a whole number of 0 or more, or
 * "unlimited". Audited as entitlement.override_set with { key, from, to, reason }.
 */
export async function setLimitOverride(
  ctx: AuthContext,
  organisationId: string,
  key: string,
  value: number | "unlimited",
  reason?: string | null,
): Promise<ChangeResult> {
  assertPlatformAdmin(ctx);
  if (!isLimitKey(key)) throw new EntitlementAdminError("unknown_key");
  const to = limitValue.parse(value);
  const note = entitlementReasonField.parse(reason ?? undefined);

  const changed = await rawDb.$transaction(async (tx) => {
    await lockOrganisation(tx, organisationId);
    const row = await tx.entitlement.findUnique({
      where: whereRow(organisationId, key, "override"),
    });
    const from = row ? overrideState(row.value) : null;
    if (from === to) return false;

    const data = { value: to, reason: note, setByUserId: ctx.user.id };
    await tx.entitlement.upsert({
      where: whereRow(organisationId, key, "override"),
      create: { organisationId, key, source: "override", ...data },
      update: data,
    });
    await audit(
      {
        organisationId,
        actorUserId: ctx.user.id,
        action: "entitlement.override_set",
        targetType: "Organisation",
        targetId: organisationId,
        metadata: { key, from, to, reason: note },
      },
      tx,
    );
    return true;
  });
  return afterChange(organisationId, key, changed);
}

/**
 * Removes a limit override, so the limit follows the plan again. Audited as
 * entitlement.override_cleared with { key, from, to: null, reason }. No
 * override: nothing is written.
 */
export async function clearLimitOverride(
  ctx: AuthContext,
  organisationId: string,
  key: string,
  reason?: string | null,
): Promise<ChangeResult> {
  assertPlatformAdmin(ctx);
  if (!isLimitKey(key)) throw new EntitlementAdminError("unknown_key");
  const note = entitlementReasonField.parse(reason ?? undefined);

  const changed = await rawDb.$transaction(async (tx) => {
    await lockOrganisation(tx, organisationId);
    const row = await tx.entitlement.findUnique({
      where: whereRow(organisationId, key, "override"),
    });
    if (!row) return false;
    await tx.entitlement.delete({ where: whereRow(organisationId, key, "override") });
    await audit(
      {
        organisationId,
        actorUserId: ctx.user.id,
        action: "entitlement.override_cleared",
        targetType: "Organisation",
        targetId: organisationId,
        metadata: { key, from: overrideState(row.value), to: null, reason: note },
      },
      tx,
    );
    return true;
  });
  return afterChange(organisationId, key, changed);
}
