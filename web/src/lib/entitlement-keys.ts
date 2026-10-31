// The entitlement registry (BILL01, ADMIN04; docs/build/design/C03.md): every
// limit and feature key the app reads through src/server/entitlements/. Keys
// are plain strings in the database (Entitlement.key, Plan.limits), so a new
// key needs an entry here and no migration. Client-safe: no zod, no server
// code. The value schemas live in src/server/entitlements/resolve.ts.
//
// Draft copy: every label and description below.

export type Release = "v0" | "v1" | "v2";

export type LimitDef = {
  label: string;
  description: string;
  /** "count" values are whole numbers; "bytes" are entered and shown in GB (decimal). */
  unit: "count" | "bytes";
  /** The unit noun, singular and plural ("1 match", "100 matches"). Unused for bytes. */
  noun: readonly [string, string];
  /** The release that enforces the limit (BILL05). It is recorded from v0. */
  release: Release;
  /** Used only when the organisation's plan lacks the key. */
  fallback: number;
};

export type FeatureDef = {
  label: string;
  description: string;
  /** The release that ships the feature behind this flag. */
  release: Release;
  /** Used only when the organisation's plan lacks the key. */
  fallback: boolean;
};

/** Plan limits. Fallbacks match the pilot plan (src/server/entitlements/plans.ts). */
export const LIMIT_KEYS = {
  matches_per_month: {
    label: "Matches per month",
    description: "Matches this organisation can upload in a calendar month.",
    unit: "count",
    noun: ["match", "matches"],
    release: "v2",
    fallback: 100,
  },
  favourited_clips: {
    label: "Favourited clips",
    description: "Clips kept beyond 14 days because someone favourited them.",
    unit: "count",
    noun: ["clip", "clips"],
    release: "v2",
    fallback: 10_000,
  },
  member_seats: {
    label: "Member seats",
    description:
      "Owners, admins and coaches in this organisation. Players and guardians never count.",
    unit: "count",
    noun: ["seat", "seats"],
    release: "v2",
    fallback: 100,
  },
  scout_seats: {
    label: "Scout seats",
    description: "Scouts and agents in this organisation.",
    unit: "count",
    noun: ["seat", "seats"],
    release: "v2",
    fallback: 50,
  },
  upload_max_bytes: {
    label: "Largest upload",
    description: "The biggest single match video this organisation can upload.",
    unit: "bytes",
    noun: ["byte", "bytes"],
    release: "v0",
    // 8 GiB, the C06 upload cap.
    fallback: 8_589_934_592,
  },
  // C10 (REVIEW01, Q-050): read from the scout network organisation for every
  // reviewer (A-7). The 48-hour claim length is a product rule, not a limit (A-4).
  review_claims_active: {
    label: "Claimed matches per scout",
    description: "Matches one scout can hold claimed at the same time.",
    unit: "count",
    noun: ["match", "matches"],
    release: "v0",
    fallback: 1,
  },
} as const satisfies Record<string, LimitDef>;

/** Feature flags. Every one is off unless the plan, an override or a flag turns it on. */
export const FEATURE_KEYS = {
  // BILL03: V201 sits behind this flag.
  billing: {
    label: "Billing",
    description:
      "Shows plans and payment pages to this organisation. Leave off until paid plans start.",
    release: "v2",
    fallback: false,
  },
  // V102.
  scout_search: {
    label: "Scout search",
    description: "Lets scouts search players across every club, not only the matches they review.",
    release: "v1",
    fallback: false,
  },
  // PROF10.
  share_links: {
    label: "Share links",
    description: "Lets players and guardians share a public link to their profile.",
    release: "v1",
    fallback: false,
  },
  // V103.
  scout_reports: {
    label: "Scout reports",
    description: "Lets scouts write reports on players.",
    release: "v1",
    fallback: false,
  },
} as const satisfies Record<string, FeatureDef>;

export type LimitKey = keyof typeof LIMIT_KEYS;
export type FeatureKey = keyof typeof FEATURE_KEYS;
export type EntitlementKey = LimitKey | FeatureKey;

/**
 * Where an effective value came from, lowest layer first: the registry fallback
 * (only when the plan lacks the key), the plan, an organisation override, a flag.
 */
export type EntitlementSource = "default" | "plan" | "override" | "flag";

/** In memory a limit is a number (Infinity when unlimited); a feature is a boolean. */
export type EntitlementValue<K extends EntitlementKey> = K extends LimitKey ? number : boolean;

/** The stored form of an unlimited limit. JSON has no Infinity. */
export const UNLIMITED = "unlimited";

export const LIMIT_KEY_LIST = Object.keys(LIMIT_KEYS) as LimitKey[];
export const FEATURE_KEY_LIST = Object.keys(FEATURE_KEYS) as FeatureKey[];

export function isLimitKey(key: string): key is LimitKey {
  return Object.hasOwn(LIMIT_KEYS, key);
}

export function isFeatureKey(key: string): key is FeatureKey {
  return Object.hasOwn(FEATURE_KEYS, key);
}
