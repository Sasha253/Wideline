import "server-only";
import type { SubscriptionStatus } from "@/generated/prisma/enums";
import {
  FEATURE_KEY_LIST,
  isLimitKey,
  LIMIT_KEY_LIST,
  type EntitlementKey,
  type EntitlementSource,
  type EntitlementValue,
  type FeatureKey,
  type LimitKey,
} from "@/lib/entitlement-keys";
import { rawDb } from "../db/raw";
import { log } from "../log";
import { PILOT_PLAN_CODE } from "./plans";
import {
  fallbackFor,
  parseValue,
  planEntry,
  resolveEntitlement,
  withinLimit,
  type InvalidLayer,
  type Layers,
} from "./resolve";

/**
 * "May this organisation do this?" (BILL01, ADMIN04). The one place limits and
 * feature flags are read. Callers never compare a limit with a literal: they
 * call hasCapacity() or may(), and tests/unit/limit-literals.test.ts fails the
 * build otherwise.
 *
 * Every export takes an explicit organisationId and reads only that
 * organisation's rows, so it uses the raw client (ESLint allowlist). Reads are
 * not cached: an admin change applies on the next call.
 */

export type PlanBasis =
  /** The organisation's own subscription. */
  | "subscription"
  /** No subscription: the pilot plan stands in (BILL02), with a logged warning. */
  | "pilot_fallback"
  /** No subscription and no pilot plan row: registry fallbacks only. */
  | "defaults";

export type EntitlementRow = {
  value: unknown;
  reason: string | null;
  setByUserId: string | null;
  updatedAt: Date;
};

export type LoadedLayers = Layers & {
  basis: PlanBasis;
  plan: { code: string; name: string } | null;
  subscription: { status: SubscriptionStatus } | null;
  overrideRows: Partial<Record<string, EntitlementRow>>;
  flagRows: Partial<Record<string, EntitlementRow>>;
};

/** The organisation's plan (or the pilot stand-in) and its Entitlement rows. */
export async function loadLayers(organisationId: string): Promise<LoadedLayers> {
  const [subscription, rows] = await Promise.all([
    rawDb.subscription.findUnique({
      where: { organisationId },
      select: { status: true, plan: { select: { code: true, name: true, limits: true } } },
    }),
    rawDb.entitlement.findMany({
      where: { organisationId },
      select: {
        key: true,
        source: true,
        value: true,
        reason: true,
        setByUserId: true,
        updatedAt: true,
      },
    }),
  ]);

  let basis: PlanBasis = "subscription";
  let plan = subscription?.plan ?? null;
  if (!subscription) {
    plan = await rawDb.plan.findUnique({
      where: { code: PILOT_PLAN_CODE },
      select: { code: true, name: true, limits: true },
    });
    basis = plan ? "pilot_fallback" : "defaults";
    log.warn({ organisationId, basis }, "organisation has no subscription");
  }

  const overrideRows: LoadedLayers["overrideRows"] = {};
  const flagRows: LoadedLayers["flagRows"] = {};
  for (const { key, source, ...row } of rows) {
    (source === "flag" ? flagRows : overrideRows)[key] = row;
  }
  const valuesOf = (r: LoadedLayers["flagRows"]) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v!.value]));

  return {
    basis,
    plan: plan && { code: plan.code, name: plan.name },
    subscription: subscription && { status: subscription.status },
    planLimits: plan?.limits ?? null,
    overrides: valuesOf(overrideRows),
    flags: valuesOf(flagRows),
    overrideRows,
    flagRows,
  };
}

function logInvalid(organisationId: string, invalid: InvalidLayer[]) {
  for (const i of invalid) {
    log.warn(
      { organisationId, key: i.key, layer: i.layer, value: i.value },
      "invalid entitlement value ignored",
    );
  }
}

/** The effective value: a number for a limit key (Infinity when unlimited), a boolean for a feature. */
export async function entitlement<K extends EntitlementKey>(
  organisationId: string,
  key: K,
): Promise<EntitlementValue<K>> {
  const resolved = resolveEntitlement(key, await loadLayers(organisationId));
  logInvalid(organisationId, resolved.invalid);
  return resolved.value;
}

/** Whether a feature is on for this organisation. */
export async function may(organisationId: string, feature: FeatureKey): Promise<boolean> {
  return entitlement(organisationId, feature);
}

/** A limit, Infinity when unlimited. Prefer hasCapacity() to comparing it yourself. */
export async function limitFor(organisationId: string, key: LimitKey): Promise<number> {
  return entitlement(organisationId, key);
}

/** True when `used + adding` stays within the organisation's limit. */
export async function hasCapacity(
  organisationId: string,
  key: LimitKey,
  used: number,
  adding = 1,
): Promise<boolean> {
  return withinLimit(await limitFor(organisationId, key), used, adding);
}

export type LayerDetail = EntitlementRow & {
  /** The parsed value, or null when the stored value is not valid (and ignored). */
  parsed: number | boolean | null;
};

export type EntitlementDetail = {
  key: EntitlementKey;
  kind: "limit" | "feature";
  /** The plan's value, or the registry fallback when the plan lacks the key or its value is invalid. */
  plan: { value: number | boolean; source: "plan" | "default"; invalid: boolean };
  override: LayerDetail | null;
  flag: LayerDetail | null;
  value: number | boolean;
  source: EntitlementSource;
};

export type OrganisationEntitlements = {
  basis: PlanBasis;
  plan: { code: string; name: string } | null;
  subscription: { status: SubscriptionStatus } | null;
  entitlements: EntitlementDetail[];
};

/** Every key with each layer, the effective value and its source, for the admin page. */
export async function entitlementsFor(organisationId: string): Promise<OrganisationEntitlements> {
  const layers = await loadLayers(organisationId);
  const detail = (row: EntitlementRow | undefined, key: EntitlementKey): LayerDetail | null =>
    row ? { ...row, parsed: parseValue(key, row.value) ?? null } : null;

  const entitlements = [...LIMIT_KEY_LIST, ...FEATURE_KEY_LIST].map((key): EntitlementDetail => {
    const resolved = resolveEntitlement(key, layers);
    logInvalid(organisationId, resolved.invalid);
    const planRaw = planEntry(layers.planLimits, key);
    const planParsed = planRaw === undefined ? undefined : parseValue(key, planRaw);
    return {
      key,
      kind: isLimitKey(key) ? "limit" : "feature",
      plan:
        planParsed === undefined
          ? { value: fallbackFor(key), source: "default", invalid: planRaw !== undefined }
          : { value: planParsed, source: "plan", invalid: false },
      override: detail(layers.overrideRows[key], key),
      flag: detail(layers.flagRows[key], key),
      value: resolved.value,
      source: resolved.source,
    };
  });

  return {
    basis: layers.basis,
    plan: layers.plan,
    subscription: layers.subscription,
    entitlements,
  };
}
