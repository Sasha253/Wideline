import type { AuthContext } from "@/server/auth/session";
import { todayIso } from "@/lib/squad-fields";
import { createPlayer } from "@/server/squad/players";

// Consent fixtures for the C05 integration tests: named players of a given age.

/** A date of birth `years` years before today (SAST), as YYYY-MM-DD. */
export function dobYearsAgo(years: number, extraDays = 0): string {
  const [y, m, d] = todayIso().split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y - years, m - 1, d - extraDays));
  return date.toISOString().slice(0, 10);
}

let n = 0;

/** A named player on `teamId`, `age` years old today (a few days past the birthday). */
export async function namedPlayer(
  ctx: AuthContext,
  teamId: string | null,
  { age = 14, firstName = "Lebo" }: { age?: number; firstName?: string } = {},
) {
  n += 1;
  return createPlayer(ctx, {
    firstName,
    lastName: `Mokoena${n}`,
    dateOfBirth: dobYearsAgo(age, 10),
    teamId: teamId ?? "",
  });
}

/** A club record of a guardian's grant, as the form posts it. */
export function guardianGrant(extra: Record<string, string> = {}) {
  return {
    grantedBy: "Thandi Mokoena",
    relationship: "parent",
    method: "paper_form",
    grantedAt: todayIso(),
    clubStats: "yes",
    scoutVisible: "yes",
    seenWording: "on",
    ...extra,
  };
}
