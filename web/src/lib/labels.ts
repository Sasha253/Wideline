import type {
  ClubStatus,
  IdDocumentType,
  OrganisationType,
  PreferredFoot,
  Role,
  ScoutAffiliationType,
  ScoutStatus,
  SubscriptionStatus,
} from "@/generated/prisma/enums";
import { LIMIT_KEYS, type EntitlementSource, type LimitKey } from "./entitlement-keys";
import { ageOn } from "./squad-fields";

// Display copy shared by server pages, emails and client components
// (docs/build/design/C01.md, "Rules for the whole chunk").

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  coach: "Coach",
  scout: "Scout",
  agent: "Agent",
  player: "Player",
  guardian: "Guardian",
  platform_admin: "Platform admin",
};

/** A role in running text, with its article: "a coach", "an admin". */
export function roleInText(role: Role): string {
  const word = ROLE_LABELS[role].toLowerCase();
  return /^[aeiou]/.test(word) ? `an ${word}` : `a ${word}`;
}

export const ORG_TYPE_LABELS: Record<OrganisationType, string> = {
  academy: "Academy",
  club: "Club",
  agency: "Agency",
  platform: "Wideline platform",
  scout_network: "Scout network",
};

// Scouts (docs/build/design/C02.md, "Labels").
export const SCOUT_STATUS_LABELS: Record<ScoutStatus, string> = {
  pending: "Awaiting approval",
  approved: "Approved",
  suspended: "Suspended",
  rejected: "Not approved",
};

export const ID_DOCUMENT_LABELS: Record<IdDocumentType, string> = {
  sa_id: "South African ID",
  passport: "Passport",
};

export const AFFILIATION_TYPE_LABELS: Record<ScoutAffiliationType, string> = {
  club: "Club",
  player: "Player",
};

// Plans and entitlements (docs/build/design/C03.md). Draft copy.
export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  active: "Active",
  past_due: "Past due",
  cancelled: "Cancelled",
  lapsed: "Lapsed",
};

/** Where an effective value came from. "{plan}" is replaced by the plan name. */
export const ENTITLEMENT_SOURCE_LABELS: Record<EntitlementSource, string> = {
  default: "Built-in default",
  plan: "From the {plan} plan",
  override: "From an override",
  flag: "From a flag",
};

/** "From the Pilot plan", "From a flag". With no plan name, a plan source reads as the built-in default. */
export function sourceText(source: EntitlementSource, planName: string | null): string {
  if (source === "plan" && !planName) return ENTITLEMENT_SOURCE_LABELS.default;
  return ENTITLEMENT_SOURCE_LABELS[source].replace("{plan}", planName ?? "");
}

const countFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const gbFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

/** "10,000": whole numbers grouped with commas. */
export function formatCount(n: number): string {
  return countFormat.format(n);
}

/** "8.59 GB", "10 GB": decimal gigabytes (10^9 bytes), never GiB. */
export function formatGB(bytes: number): string {
  return `${gbFormat.format(bytes / 1_000_000_000)} GB`;
}

/** A limit as text: "Unlimited", "8.59 GB", "1 match", "100 matches". */
export function limitText(key: LimitKey, value: number): string {
  if (value === Infinity) return "Unlimited";
  const def = LIMIT_KEYS[key];
  if (def.unit === "bytes") return formatGB(value);
  return `${formatCount(value)} ${value === 1 ? def.noun[0] : def.noun[1]}`;
}

/** The types an organisation can choose. platform and scout_network are display only. */
export const SELECTABLE_ORG_TYPES = ["academy", "club", "agency"] as const;

const dateFormat = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Johannesburg",
});

/** "6 Nov 2026", the same formatter as Lab matches. */
export function formatDate(date: Date): string {
  return dateFormat.format(date);
}

const DAY = 24 * 60 * 60 * 1000;

/** "in 14 days", "in 1 day", "today" (under 24 hours left), "1 day ago", "3 days ago". */
export function relativeExpiry(expiresAt: Date, now = new Date()): string {
  const diff = expiresAt.getTime() - now.getTime();
  if (diff >= 0) {
    if (diff < DAY) return "today";
    const days = Math.round(diff / DAY);
    return days === 1 ? "in 1 day" : `in ${days} days`;
  }
  const days = Math.max(1, Math.round(-diff / DAY));
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

const regionNames = new Intl.DisplayNames("en-ZA", { type: "region" });

export function countryName(code: string): string {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "South African ID", or "Passport · United Kingdom" (`joiner` "issued by" reads "Passport · issued by …"). */
export function identityText(type: IdDocumentType, country: string, joiner = ""): string {
  if (type === "sa_id") return ID_DOCUMENT_LABELS.sa_id;
  return `${ID_DOCUMENT_LABELS.passport} · ${joiner ? `${joiner} ` : ""}${countryName(country)}`;
}

/** "Gauteng, South Africa", or the country alone when there is no region. */
export function locationText(country: string, region: string | null | undefined): string {
  const name = countryName(country);
  return region ? `${region}, ${name}` : name;
}

export const SA_PROVINCES = [
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
  "Western Cape",
];

// ISO 3166-1 alpha-2 codes. Intl has no list of regions, so they are listed here.
const ISO_COUNTRIES =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  );

export const COUNTRY_CODES: ReadonlySet<string> = new Set(ISO_COUNTRIES);

/** Country options: South Africa first, then the rest by their en-ZA name. */
export function countryOptions(): { code: string; name: string }[] {
  const collator = new Intl.Collator("en-ZA");
  const rest = ISO_COUNTRIES.filter((c) => c !== "ZA")
    .map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => collator.compare(a.name, b.name));
  return [{ code: "ZA", name: countryName("ZA") }, ...rest];
}

// Squad (docs/build/design/C04.md, "Labels").
export const FOOT_LABELS: Record<PreferredFoot, string> = {
  left: "Left",
  right: "Right",
  both: "Both",
};

/** The PlayerCard words, for card meta and the player hero. */
export const FOOT_PHRASES: Record<PreferredFoot, string> = {
  left: "Left foot",
  right: "Right foot",
  both: "Both feet",
};

export const CLUB_STATUS_LABELS: Record<ClubStatus, string> = {
  active: "Current",
  departed: "Departed",
};

/** Whole years, as a number: "14" in tables, "Age 14" elsewhere. Null without a date of birth. */
export function formatAge(dob: Date | null | undefined, now = new Date()): number | null {
  return dob ? ageOn(dob, now) : null;
}

type NamedPlayer = {
  firstName: string | null;
  lastName: string | null;
  isPlaceholder?: boolean;
  squadNumber?: number | null;
};

/** "Thabo Nkosi"; a placeholder is "Unnamed #7", or "Unnamed player" without a number. */
export function playerName(p: NamedPlayer): string {
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  if (name && !p.isPlaceholder) return name;
  return p.squadNumber != null ? `Unnamed #${p.squadNumber}` : "Unnamed player";
}

/** "U15 Boys (2026)": a team in selects, captions, banners and errors. */
export function teamLabel(t: { name: string; season: string }): string {
  return `${t.name} (${t.season})`;
}
