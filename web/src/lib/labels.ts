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

const dateTimeFormat = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Africa/Johannesburg",
});

/** "24 Oct 2026, 14:05": the date as formatDate, then the 24-hour time in South Africa (C05 history). */
export function formatDateTime(date: Date): string {
  const parts = dateTimeFormat.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return `${formatDate(date)}, ${get("hour")}:${get("minute")}`;
}

/**
 * An email address with most of its local part hidden: "t***@example.com"
 * (C05, Q-019). Shown to the club after Wideline emails a guardian link, so the
 * full address never goes back to the browser.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
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

// Matches and upload (docs/build/design/C06.md, "Dates and times"). Africa/Johannesburg.

/** "Home v Away": a fixture in titles, intros and dialogs. Team names as in Squad, no season. */
export function fixtureText(m: { homeTeam: { name: string }; awayTeam: { name: string } }): string {
  return `${m.homeTeam.name} v ${m.awayTeam.name}`;
}

const sastParts = (date: Date, options: Intl.DateTimeFormatOptions) => {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    ...options,
    timeZone: "Africa/Johannesburg",
  }).formatToParts(date);
  return (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
};

/** "Sat 18 Oct 2026": weekday plus date, for the match hero. Built from parts (no comma). */
export function formatMatchDate(date: Date): string {
  const part = sastParts(date, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${part("weekday")} ${part("day")} ${part("month")} ${part("year")}`;
}

const sastDayKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Johannesburg",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "15:40" today, "09:10 tomorrow", later "Mon 27 Oct, 09:10" (South African time). */
export function formatReadyBy(date: Date, now = new Date()): string {
  const part = sastParts(date, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const time = `${part("hour")}:${part("minute")}`;
  const day = sastDayKey.format(date);
  if (day === sastDayKey.format(now)) return time;
  if (day === sastDayKey.format(new Date(now.getTime() + DAY))) return `${time} tomorrow`;
  return `${part("weekday")} ${part("day")} ${part("month")}, ${time}`;
}

/** "450 MB" under 1 GB (whole MB, 10^6 bytes), else formatGB: "4.8 GB". */
export function formatSize(bytes: number): string {
  if (bytes < 1_000_000_000) return `${countFormat.format(Math.floor(bytes / 1_000_000))} MB`;
  return formatGB(bytes);
}

const speedFormat = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** "3.4 MB/s"; below 0.1 MB/s "under 0.1 MB/s". */
export function formatSpeed(bytesPerSec: number): string {
  const mb = bytesPerSec / 1_000_000;
  if (mb < 0.1) return "under 0.1 MB/s";
  return `${speedFormat.format(mb)} MB/s`;
}

/** Time left: "under 1 min", "12 min", "1 h 20 min", "2 h". Rounds up, so it never understates. */
export function formatEta(sec: number): string {
  if (sec < 60) return "under 1 min";
  const minutes = Math.ceil(sec / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** A recording's length in whole minutes: "92 min". */
export function formatFootageLength(sec: number): string {
  return `${Math.round(sec / 60)} min`;
}

/**
 * A video position: "47:12.4" with one decimal, or "47:12" with none. Minutes
 * are not capped at 59 ("112:31.0").
 */
export function formatVideoTime(ms: number, decimals: 0 | 1 = 1): string {
  const unit = decimals ? 100 : 1000;
  const units = Math.floor(Math.max(0, ms) / unit);
  const perMinute = 60_000 / unit;
  const minutes = Math.floor(units / perMinute);
  const rest = units - minutes * perMinute;
  const seconds = decimals ? Math.floor(rest / 10) : rest;
  const ss = String(seconds).padStart(2, "0");
  return decimals ? `${minutes}:${ss}.${rest % 10}` : `${minutes}:${ss}`;
}

/** "24" for 23.976, "30" for 29.97, "12.5": up to one decimal, trailing zero dropped. */
export function formatFps(fps: number): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(fps);
}

/**
 * C09 (Lab recall): a rate as whole percent rounded down, so 94.6% reads 94%
 * and never as meeting a 95% target. Null when there is nothing to divide by.
 */
export function formatRate(matched: number, total: number): string | null {
  if (total <= 0) return null;
  return `${Math.floor((100 * matched) / total)}%`;
}

/** Q-048: fewer tags than this of one type, per match or per model version, is a small sample. */
export const SMALL_SAMPLE_TAGS = 10;
/** Q-048: fewer matches than this behind a model version's numbers is a small sample. */
export const SMALL_SAMPLE_MATCHES = 3;
