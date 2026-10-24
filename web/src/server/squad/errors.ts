import { playerName, teamLabel } from "@/lib/labels";
import { consentVisibleTo } from "../consent/visibility";
import type { ScopedDb } from "../db/scoped";

// Errors for the squad module and the copy they carry (docs/build/design/C04.md).

/** The partial unique index on active players' squad numbers (schema.prisma, Player). */
export const SQUAD_NUMBER_INDEX = "Player_team_squadNumber_active_key";

/**
 * The code of a Prisma known request error ("P2002"). Checked by shape: the
 * Prisma client module is for the files ESLint allows raw database access.
 */
export function prismaErrorCode(err: unknown): string | null {
  if (!(err instanceof Error) || !("code" in err) || typeof err.code !== "string") return null;
  return /^P\d{4}$/.test(err.code) ? err.code : null;
}

/** Prisma's error for a unique violation, whatever shape its meta takes with the pg adapter. */
function uniqueViolationText(err: unknown): string | null {
  if (prismaErrorCode(err) !== "P2002") return null;
  const meta = (err as { meta?: unknown }).meta;
  return `${JSON.stringify(meta ?? {})} ${(err as Error).message}`;
}

/** A concurrent write took the same squad number (P2002 on SQUAD_NUMBER_INDEX). */
export function isSquadNumberViolation(err: unknown): boolean {
  const text = uniqueViolationText(err);
  return text !== null && (text.includes(SQUAD_NUMBER_INDEX) || text.includes("squadNumber"));
}

/**
 * The unique index on Team ("organisationId", lower("name"), "season"), in raw
 * SQL only (migration 20261024093500_c04_squad_rules; Prisma cannot express it).
 */
export const TEAM_NAME_INDEX = "Team_organisationId_lower_name_season_key";

/** Another team already has this name, in any case, in this season (P2002 on TEAM_NAME_INDEX). */
export function isTeamNameViolation(err: unknown): boolean {
  const text = uniqueViolationText(err);
  return text !== null && (text.includes(TEAM_NAME_INDEX) || text.includes("name"));
}

type TeamRef = { name: string; season: string };

/**
 * "Number 7 is already taken in U15 Boys (2026) by Thabo Nkosi. Choose another
 * number." Without a holder (a concurrent write), the name is left out.
 */
export function squadNumberTakenMessage(number: number, team: TeamRef, holder?: string): string {
  const by = holder ? ` by ${holder}` : "";
  return `Number ${number} is already taken in ${teamLabel(team)}${by}. Choose another number.`;
}

/**
 * Undoing a departure when an active teammate now wears the player's number:
 * "Number 7 is now worn by Sipho Dlamini in U15 Boys (2026). Give them another
 * number first, then undo the departure." Without a holder (a concurrent
 * write), the name is left out.
 */
export function undoNumberTakenMessage(number: number, team: TeamRef, holder?: string): string {
  const by = holder ? `worn by ${holder}` : "taken";
  const who = holder ? "them" : "that player";
  return `Number ${number} is now ${by} in ${teamLabel(team)}. Give ${who} another number first, then undo the departure.`;
}

/** The active player on a team who wears this number, if any. */
export async function findNumberHolder(
  db: Pick<ScopedDb, "player">,
  {
    teamId,
    squadNumber,
    exceptPlayerId,
  }: {
    teamId: string;
    squadNumber: number;
    exceptPlayerId?: string;
  },
) {
  const holder = await db.player.findFirst({
    where: {
      teamId,
      squadNumber,
      clubStatus: "active",
      ...(exceptPlayerId && { id: { not: exceptPlayerId } }),
      ...consentVisibleTo({ kind: "club" }),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      isPlaceholder: true,
      squadNumber: true,
    },
  });
  return holder ? { id: holder.id, name: playerName(holder) } : null;
}

export type TeamErrorCode = "not_found" | "duplicate_name" | "in_use";

export type TeamUsage = { players: number; matches: number; lineups: number };

export class TeamError extends Error {
  constructor(
    readonly code: TeamErrorCode,
    readonly detail: { usage?: TeamUsage; isOpposition?: boolean } = {},
  ) {
    super(`Team: ${code}`);
    this.name = "TeamError";
  }
}

export type PlayerErrorCode =
  | "not_found"
  | "departed"
  | "not_departed"
  | "undo_expired"
  | "squad_number_taken"
  | "wrong_team_kind"
  | "placeholder_only";

export class PlayerError extends Error {
  constructor(
    readonly code: PlayerErrorCode,
    /** The copy to show, when the code alone does not say it (a taken number, a name). */
    readonly userMessage?: string,
    /** The form field the message belongs on. */
    readonly field?: string,
  ) {
    super(`Player: ${code}`);
    this.name = "PlayerError";
  }
}
