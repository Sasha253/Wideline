import "server-only";
import { AuthzError, type AuthContext } from "../auth/session";
import { consentVisibleTo } from "../consent/visibility";
import { rawDb } from "../db/raw";

/**
 * The players a scout may see outside review (CONS03, NFR11): scout_visible
 * consent, named, in an active club, through consentVisibleTo({ kind: "scout" }).
 * It reads the live Player.consentState, so a withdrawal or a change to club
 * only hides the player from the very next call (tests/integration/
 * consent-visibility.test.ts, the C05 acceptance test).
 *
 * Minimal on purpose: C13 (player profiles) and C15 (shortlist entries) build
 * their scout reads on this, and must keep the consentVisibleTo filter. Players
 * belong to many organisations, so it uses the raw client with the scout role
 * checked here; it returns only what a scout card needs.
 *
 * Departed players: no clubStatus filter, on purpose. A departed player's
 * consent still governs what scouts see (PRD PROF09: the profile stays under
 * the player's or guardian's control after they leave the club), so a departed
 * player with scout_visible consent stays visible to scouts until that consent
 * is withdrawn, which the family can still do through the club or an unrevoked
 * guardian link.
 */
export type ScoutVisiblePlayer = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  clubName: string;
};

export async function scoutVisiblePlayers(
  ctx: Pick<AuthContext, "roles">,
  { playerIds }: { playerIds: readonly string[] },
): Promise<ScoutVisiblePlayer[]> {
  if (!ctx.roles.includes("scout")) throw new AuthzError(403, "Requires one of: scout");
  if (playerIds.length === 0) return [];
  const rows = await rawDb.player.findMany({
    where: {
      id: { in: [...playerIds] },
      organisation: { status: "active" },
      ...consentVisibleTo({ kind: "scout" }),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      position: true,
      organisation: { select: { name: true } },
    },
  });
  return rows.map(({ organisation, ...p }) => ({ ...p, clubName: organisation.name }));
}
