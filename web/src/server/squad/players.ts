import "server-only";
import type { ClubStatus, ConsentState, PreferredFoot } from "@/generated/prisma/enums";
import type { PlayerWhereInput } from "@/generated/prisma/models";
import { playerName, teamLabel } from "@/lib/labels";
import { canUndoDeparture } from "@/lib/squad-fields";
import type { AuthContext } from "../auth/session";
import { audit } from "../audit";
import { enqueueConsentWithdrawn } from "../consent/jobs";
import { withdrawSelfConsentOfMinor } from "../consent/records";
import { consentVisibleTo } from "../consent/visibility";
import { requireSquadOrg } from "./access";
import {
  findNumberHolder,
  isSquadNumberViolation,
  PlayerError,
  squadNumberTakenMessage,
  undoNumberTakenMessage,
} from "./errors";
import {
  departureUndoExpired,
  OPPOSITION_TEAM_CHOSEN,
  placeholderSchema,
  playerDeparted,
  playerNotDeparted,
  playerSchema,
  shirtNumbersTaken,
  type PlayerInput,
} from "./fields";
import { compareTeams } from "./teams";
import { asTransactionClient } from "./tx";

/**
 * Players of the active organisation (SQUAD02, SQUAD04, SQUAD07, SQUAD09).
 * Every read and write goes through the scoped client. Audit rows carry ids
 * and changed field names only: never a name or a date of birth.
 *
 * Departure (SQUAD09) sets clubStatus and departedAt and nothing else. A
 * departed player keeps every record, is read-only to the club, and drops out
 * of ACTIVE_PLAYER, the filter behind every picker and dashboard.
 */

export { PlayerError };

/**
 * The players a club works with: not departed. C06 lineup pickers and the C14
 * dashboard filter with this (or activePlayers()), so a departed player
 * vanishes from them with no work there.
 */
export const ACTIVE_PLAYER = { clubStatus: "active" } as const satisfies PlayerWhereInput;

const PLAYER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  isPlaceholder: true,
  dateOfBirth: true,
  position: true,
  preferredFoot: true,
  heightCm: true,
  squadNumber: true,
  consentState: true,
  clubStatus: true,
  departedAt: true,
  teamId: true,
  team: { select: { id: true, name: true, season: true, isOpposition: true } },
} as const;

export type PlayerRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  isPlaceholder: boolean;
  dateOfBirth: Date | null;
  position: string | null;
  preferredFoot: PreferredFoot | null;
  heightCm: number | null;
  squadNumber: number | null;
  /** CONS01: the cached state of the newest Consent row (C05). Club views only. */
  consentState: ConsentState;
  clubStatus: ClubStatus;
  departedAt: Date | null;
  teamId: string | null;
  team: { id: string; name: string; season: string; isOpposition: boolean } | null;
};

/** Squad number ascending with blanks last, then last name, then first name. */
function compareInTeam(a: PlayerRow, b: PlayerRow): number {
  const na = a.squadNumber ?? Infinity;
  const nb = b.squadNumber ?? Infinity;
  return (
    na - nb ||
    (a.lastName ?? "").localeCompare(b.lastName ?? "", "en-ZA") ||
    (a.firstName ?? "").localeCompare(b.firstName ?? "", "en-ZA")
  );
}

/**
 * Active players of one team, by squad number: the lineup picker source (C06),
 * opposition placeholders included.
 */
export async function activePlayers(
  ctx: AuthContext,
  { teamId }: { teamId: string },
): Promise<PlayerRow[]> {
  requireSquadOrg(ctx);
  const rows = await ctx.db.player.findMany({
    where: { teamId, ...ACTIVE_PLAYER, ...consentVisibleTo({ kind: "club" }) },
    select: PLAYER_SELECT,
  });
  return rows.sort(compareInTeam);
}

/**
 * The squad list (/squad). Current: by team (season newest, then name), squad
 * number, last name. Departed: newest departure first. Players on opposition
 * teams never appear; a player with no team appears under all teams.
 */
export async function listPlayers(
  ctx: AuthContext,
  { teamId, status }: { teamId?: string | null; status: "current" | "departed" },
): Promise<PlayerRow[]> {
  requireSquadOrg(ctx);
  const rows = await ctx.db.player.findMany({
    where: {
      ...consentVisibleTo({ kind: "club" }),
      clubStatus: status === "departed" ? "departed" : "active",
      ...(teamId
        ? { teamId, team: { isOpposition: false } }
        : { OR: [{ teamId: null }, { team: { isOpposition: false } }] }),
    },
    select: PLAYER_SELECT,
  });
  if (status === "departed") {
    return rows.sort(
      (a, b) =>
        (b.departedAt?.getTime() ?? 0) - (a.departedAt?.getTime() ?? 0) || compareInTeam(a, b),
    );
  }
  return rows.sort((a, b) => {
    if (a.team && b.team) return compareTeams(a.team, b.team) || compareInTeam(a, b);
    if (a.team || b.team) return a.team ? -1 : 1;
    return compareInTeam(a, b);
  });
}

/** Current and departed counts for the status tabs, with the same team filter as listPlayers. */
export async function countPlayers(
  ctx: AuthContext,
  { teamId }: { teamId?: string | null },
): Promise<{ current: number; departed: number }> {
  requireSquadOrg(ctx);
  const groups = await ctx.db.player.groupBy({
    by: ["clubStatus"],
    where: {
      ...consentVisibleTo({ kind: "club" }),
      ...(teamId
        ? { teamId, team: { isOpposition: false } }
        : { OR: [{ teamId: null }, { team: { isOpposition: false } }] }),
    },
    _count: true,
  });
  const of = (s: ClubStatus) => groups.find((g) => g.clubStatus === s)?._count ?? 0;
  return { current: of("active"), departed: of("departed") };
}

/** One player. Throws PlayerError("not_found") for an unknown or foreign id. */
export async function getPlayer(ctx: AuthContext, playerId: string): Promise<PlayerRow> {
  requireSquadOrg(ctx);
  const player = await ctx.db.player.findFirst({
    where: { id: playerId, ...consentVisibleTo({ kind: "club" }) },
    select: PLAYER_SELECT,
  });
  if (!player) throw new PlayerError("not_found");
  return player;
}

/** An own team of this organisation, for a named player. */
async function ownTeam(ctx: AuthContext, teamId: string) {
  const team = await ctx.db.team.findFirst({
    where: { id: teamId },
    select: { id: true, name: true, season: true, isOpposition: true },
  });
  if (!team || team.isOpposition) {
    throw new PlayerError("wrong_team_kind", OPPOSITION_TEAM_CHOSEN, "teamId");
  }
  return team;
}

async function assertNumberFree(
  ctx: AuthContext,
  team: { id: string; name: string; season: string },
  squadNumber: number | null,
  exceptPlayerId?: string,
) {
  if (squadNumber === null) return;
  const holder = await findNumberHolder(ctx.db, { teamId: team.id, squadNumber, exceptPlayerId });
  if (holder) {
    throw new PlayerError(
      "squad_number_taken",
      squadNumberTakenMessage(squadNumber, team, holder.name),
      "squadNumber",
    );
  }
}

/** A P2002 on the squad number index, as the same message without the name. */
function numberRace(err: unknown, team: { name: string; season: string } | null, n: number | null) {
  if (team && n !== null && isSquadNumberViolation(err)) {
    return new PlayerError("squad_number_taken", squadNumberTakenMessage(n, team), "squadNumber");
  }
  return err;
}

const FIELDS = [
  "firstName",
  "lastName",
  "dateOfBirth",
  "position",
  "preferredFoot",
  "heightCm",
  "squadNumber",
  "teamId",
] as const;

/** Creates a named player on an own team (or no team). */
export async function createPlayer(
  ctx: AuthContext,
  input: PlayerInput,
): Promise<{
  id: string;
  name: string;
  team: { id: string; name: string; season: string } | null;
}> {
  requireSquadOrg(ctx);
  const data = playerSchema.parse(input);
  const team = data.teamId ? await ownTeam(ctx, data.teamId) : null;
  if (team) await assertNumberFree(ctx, team, data.squadNumber);
  try {
    return await ctx.db.$transaction(async (tx) => {
      const player = await tx.player.create({
        data: { ...data, organisationId: ctx.organisationId },
        select: { id: true },
      });
      await audit(
        {
          organisationId: ctx.organisationId,
          actorUserId: ctx.user.id,
          action: "player.create",
          targetType: "Player",
          targetId: player.id,
          metadata: { teamId: data.teamId, fields: FIELDS.filter((f) => data[f] !== null) },
        },
        asTransactionClient(tx),
      );
      return {
        id: player.id,
        name: playerName(data),
        team: team && { id: team.id, name: team.name, season: team.season },
      };
    });
  } catch (err) {
    throw numberRace(err, team, data.squadNumber);
  }
}

const sameValue = (a: unknown, b: unknown) =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

/**
 * Saves a current, named player. Refuses a departed player (read-only to the
 * club, SQUAD09) and a placeholder. The update matches clubStatus active, so a
 * departure that lands meanwhile wins. Audits changed field names only.
 *
 * A new or cleared date of birth that makes the player under 18 on the date
 * they gave consent themselves withdraws that consent in the same transaction
 * (CONS02, NFR08; withdrawSelfConsentOfMinor), then enqueues the
 * consent-withdrawn job. consentWithdrawn says so, for the confirmation.
 */
export async function updatePlayer(
  ctx: AuthContext,
  playerId: string,
  input: PlayerInput,
): Promise<{ changed: string[]; name: string; consentWithdrawn: boolean }> {
  requireSquadOrg(ctx);
  const current = await getPlayer(ctx, playerId);
  if (current.team?.isOpposition || current.isPlaceholder)
    throw new PlayerError("placeholder_only");
  if (current.clubStatus === "departed") {
    throw new PlayerError("departed", playerDeparted(playerName(current)));
  }
  const data = playerSchema.parse(input);
  const team = data.teamId ? await ownTeam(ctx, data.teamId) : null;
  const changed = FIELDS.filter((f) => !sameValue(data[f], current[f]));
  const name = playerName(data);
  if (changed.length === 0) return { changed, name, consentWithdrawn: false };
  if (team && (changed.includes("squadNumber") || changed.includes("teamId"))) {
    await assertNumberFree(ctx, team, data.squadNumber, playerId);
  }
  let withdrawal: Awaited<ReturnType<typeof withdrawSelfConsentOfMinor>> = null;
  try {
    withdrawal = await ctx.db.$transaction(async (tx) => {
      const res = await tx.player.updateMany({
        where: { id: playerId, ...ACTIVE_PLAYER },
        data: Object.fromEntries(changed.map((f) => [f, data[f]])),
      });
      if (res.count === 0) throw new PlayerError("departed", playerDeparted(playerName(current)));
      // The update above holds the player row lock, so no consent change lands
      // between it and this check.
      const withdrawn = changed.includes("dateOfBirth")
        ? await withdrawSelfConsentOfMinor(asTransactionClient(tx), ctx, playerId, data.dateOfBirth)
        : null;
      await audit(
        {
          organisationId: ctx.organisationId,
          actorUserId: ctx.user.id,
          action: "player.update",
          targetType: "Player",
          targetId: playerId,
          metadata: { changed },
        },
        asTransactionClient(tx),
      );
      return withdrawn;
    });
  } catch (err) {
    throw numberRace(err, team, data.squadNumber);
  }
  if (withdrawal) {
    await enqueueConsentWithdrawn({
      organisationId: ctx.organisationId,
      playerId,
      consentId: withdrawal.consentId,
    });
  }
  return { changed, name, consentWithdrawn: withdrawal !== null };
}

/**
 * Adds unnamed placeholders (SQUAD07) to an opposition team: one per shirt
 * number, no name, no date of birth. All or nothing: a number already on the
 * team refuses the whole list.
 */
export async function addPlaceholders(
  ctx: AuthContext,
  teamId: string,
  numbers: number[],
): Promise<{ added: number }> {
  requireSquadOrg(ctx);
  const team = await ctx.db.team.findFirst({
    where: { id: teamId },
    select: { id: true, isOpposition: true },
  });
  if (!team) throw new PlayerError("not_found");
  if (!team.isOpposition) throw new PlayerError("wrong_team_kind");
  const rows = numbers.map((n) => placeholderSchema.parse({ squadNumber: n }));
  const unique = [...new Set(rows.map((r) => r.squadNumber))].sort((a, b) => a - b);
  const takenNumbers = async (db: Pick<typeof ctx.db, "player">) =>
    (
      await db.player.findMany({
        where: {
          teamId,
          ...ACTIVE_PLAYER,
          squadNumber: { in: unique },
          ...consentVisibleTo({ kind: "club" }),
        },
        select: { squadNumber: true },
        orderBy: { squadNumber: "asc" },
      })
    ).map((p) => p.squadNumber!);
  const taken = await takenNumbers(ctx.db);
  if (taken.length > 0) {
    throw new PlayerError("squad_number_taken", shirtNumbersTaken(taken), "numbers");
  }
  try {
    await ctx.db.$transaction(async (tx) => {
      await tx.player.createMany({
        data: unique.map((squadNumber) => ({
          organisationId: ctx.organisationId,
          teamId,
          squadNumber,
          isPlaceholder: true,
        })),
      });
      await audit(
        {
          organisationId: ctx.organisationId,
          actorUserId: ctx.user.id,
          action: "team.placeholders_add",
          targetType: "Team",
          targetId: teamId,
          metadata: { count: unique.length },
        },
        asTransactionClient(tx),
      );
    });
  } catch (err) {
    if (isSquadNumberViolation(err)) {
      const now = await takenNumbers(ctx.db);
      throw new PlayerError(
        "squad_number_taken",
        shirtNumbersTaken(now.length ? now : unique),
        "numbers",
      );
    }
    throw err;
  }
  return { added: unique.length };
}

/**
 * Marks a current player departed (SQUAD09): one update of clubStatus and
 * departedAt, matched on clubStatus active, and the player.depart audit row,
 * in one transaction. No other table is touched: lineups, matches, stats and
 * consent records stay, and so does teamId.
 */
export async function markDeparted(
  ctx: AuthContext,
  playerId: string,
  now = new Date(),
): Promise<{ name: string; firstName: string }> {
  requireSquadOrg(ctx);
  const player = await getPlayer(ctx, playerId);
  if (player.team?.isOpposition || player.isPlaceholder) throw new PlayerError("placeholder_only");
  const name = playerName(player);
  if (player.clubStatus === "departed") throw new PlayerError("departed", name);
  await ctx.db.$transaction(async (tx) => {
    const res = await tx.player.updateMany({
      where: { id: playerId, ...ACTIVE_PLAYER },
      data: { clubStatus: "departed", departedAt: now },
    });
    if (res.count === 0) throw new PlayerError("departed", name);
    await audit(
      {
        organisationId: ctx.organisationId,
        actorUserId: ctx.user.id,
        action: "player.depart",
        targetType: "Player",
        targetId: playerId,
        metadata: { teamId: player.teamId },
      },
      asTransactionClient(tx),
    );
  });
  return { name, firstName: player.firstName ?? name };
}

/**
 * Undoes a departure within DEPARTURE_UNDO_DAYS (SQUAD09, Q-012): clubStatus
 * back to active and departedAt cleared, matched on the departure being undone,
 * and the player.depart_undone audit row (the departure time only, no names),
 * in one transaction. The player's squad number must be free on their team:
 * when an active teammate wears it now, a squadNumber field error asks for
 * that number to change first. After the window the player stays read-only.
 */
export async function undoDeparture(
  ctx: AuthContext,
  playerId: string,
  now = new Date(),
): Promise<{ name: string }> {
  requireSquadOrg(ctx);
  const player = await getPlayer(ctx, playerId);
  if (player.team?.isOpposition || player.isPlaceholder) throw new PlayerError("placeholder_only");
  const name = playerName(player);
  const departedAt = player.departedAt;
  if (player.clubStatus !== "departed" || !departedAt) {
    throw new PlayerError("not_departed", playerNotDeparted(name));
  }
  if (!canUndoDeparture(departedAt, now)) {
    throw new PlayerError("undo_expired", departureUndoExpired(player.firstName ?? name));
  }
  const { team, squadNumber } = player;
  if (team && squadNumber !== null) {
    const holder = await findNumberHolder(ctx.db, {
      teamId: team.id,
      squadNumber,
      exceptPlayerId: playerId,
    });
    if (holder) {
      throw new PlayerError(
        "squad_number_taken",
        undoNumberTakenMessage(squadNumber, team, holder.name),
        "squadNumber",
      );
    }
  }
  try {
    await ctx.db.$transaction(async (tx) => {
      const res = await tx.player.updateMany({
        where: { id: playerId, clubStatus: "departed", departedAt },
        data: { clubStatus: "active", departedAt: null },
      });
      if (res.count === 0) throw new PlayerError("not_departed", playerNotDeparted(name));
      await audit(
        {
          organisationId: ctx.organisationId,
          actorUserId: ctx.user.id,
          action: "player.depart_undone",
          targetType: "Player",
          targetId: playerId,
          metadata: { departedAt: departedAt.toISOString() },
        },
        asTransactionClient(tx),
      );
    });
  } catch (err) {
    // A teammate took the number between the check and the update.
    if (team && squadNumber !== null && isSquadNumberViolation(err)) {
      throw new PlayerError(
        "squad_number_taken",
        undoNumberTakenMessage(squadNumber, team),
        "squadNumber",
      );
    }
    throw err;
  }
  return { name };
}

/** "U15 Boys (2026)", or null for a player with no team. */
export function playerTeamLabel(p: Pick<PlayerRow, "team">): string | null {
  return p.team ? teamLabel(p.team) : null;
}
