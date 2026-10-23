// No "server-only" import and no database: pure functions, unit-tested in
// tests/unit/entitlement-resolve.test.ts.
import { z } from "zod";
import {
  FEATURE_KEYS,
  isLimitKey,
  LIMIT_KEYS,
  UNLIMITED,
  type EntitlementKey,
  type EntitlementSource,
  type EntitlementValue,
} from "@/lib/entitlement-keys";

/**
 * Entitlement resolution (BILL01; PRD "Billing requirements"): the registry
 * fallback (only when the plan lacks the key), then the plan, then the
 * organisation's override, then its flag. A flag has the last word.
 *
 * Every layer is checked against the key's value schema. An invalid value is
 * skipped, so the next lower layer wins, and it is reported to the caller to
 * log. In memory "unlimited" becomes Infinity, so `used < limit` stays right.
 */

/** A stored limit: a whole number of 0 or more, or "unlimited" (JSON has no Infinity). */
export const limitValue = z.union([z.number().int().nonnegative(), z.literal(UNLIMITED)]);
/** A stored feature value. */
export const featureValue = z.boolean();

export type StoredLimit = z.infer<typeof limitValue>;

export type Layers = {
  /** The plan's limits JSON, or null with no plan at all (registry fallbacks only). */
  planLimits: unknown;
  /** Stored override values by key (Entitlement rows with source override). */
  overrides: Partial<Record<string, unknown>>;
  /** Stored flag values by key (Entitlement rows with source flag). */
  flags: Partial<Record<string, unknown>>;
};

export type InvalidLayer = {
  key: EntitlementKey;
  layer: "plan" | "override" | "flag";
  value: unknown;
};

export type Resolved<K extends EntitlementKey> = {
  value: EntitlementValue<K>;
  source: EntitlementSource;
  /** Layers that held a value the key's schema refused, lowest first. */
  invalid: InvalidLayer[];
};

/** A stored value in its in-memory form, or undefined when the schema refuses it. */
export function parseValue<K extends EntitlementKey>(
  key: K,
  raw: unknown,
): EntitlementValue<K> | undefined {
  if (isLimitKey(key)) {
    const parsed = limitValue.safeParse(raw);
    if (!parsed.success) return undefined;
    return (parsed.data === UNLIMITED ? Infinity : parsed.data) as EntitlementValue<K>;
  }
  const parsed = featureValue.safeParse(raw);
  return parsed.success ? (parsed.data as EntitlementValue<K>) : undefined;
}

/** The registry fallback of a key. */
export function fallbackFor<K extends EntitlementKey>(key: K): EntitlementValue<K> {
  return (
    isLimitKey(key)
      ? LIMIT_KEYS[key].fallback
      : FEATURE_KEYS[key as keyof typeof FEATURE_KEYS].fallback
  ) as EntitlementValue<K>;
}

/** The plan's raw value for a key, or undefined when the plan lacks it. Other keys are ignored. */
export function planEntry(planLimits: unknown, key: string): unknown {
  if (!planLimits || typeof planLimits !== "object" || Array.isArray(planLimits)) return undefined;
  return Object.hasOwn(planLimits, key) ? (planLimits as Record<string, unknown>)[key] : undefined;
}

export function resolveEntitlement<K extends EntitlementKey>(key: K, layers: Layers): Resolved<K> {
  let value = fallbackFor(key);
  let source: EntitlementSource = "default";
  const invalid: InvalidLayer[] = [];
  const steps: [InvalidLayer["layer"], unknown][] = [
    ["plan", planEntry(layers.planLimits, key)],
    ["override", layers.overrides[key]],
    ["flag", layers.flags[key]],
  ];
  for (const [layer, raw] of steps) {
    if (raw === undefined) continue;
    const parsed = parseValue(key, raw);
    if (parsed === undefined) {
      invalid.push({ key, layer, value: raw });
      continue;
    }
    value = parsed;
    source = layer;
  }
  return { value, source, invalid };
}

/** True when `adding` more still fits under the limit. Infinity always fits. */
export function withinLimit(limit: number, used: number, adding = 1): boolean {
  return used + adding <= limit;
}

/** The stored form of an in-memory limit (Infinity is "unlimited"). */
export function toStoredLimit(value: number): StoredLimit {
  return value === Infinity ? UNLIMITED : value;
}
