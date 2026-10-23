import type { OrganisationType, Role } from "@/generated/prisma/enums";

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
};

/** The types an organisation can choose. platform is display only. */
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
