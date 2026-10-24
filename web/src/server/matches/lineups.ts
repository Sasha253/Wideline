import "server-only";
import type { ClubStatus, MatchStatus } from "@/generated/prisma/enums";
import { playerName } from "@/lib/labels";
import { maxSubstitutionMinute } from "@/lib/match-clock";
import type { AuthContext } from "../auth/session";
import { audit } from "../audit";
import { consentVisibleTo } from "../consent/visibility";
import { prismaErrorCode } from "../squad/errors";
import { ACTIVE_PLAYER, activePlayers, type PlayerRow } from "../squad/players";
import { asTransactionClient } from "../squad/tx";
import { isLocked, requireSquadOrg } from "./access";
import { lockedMessage, MatchError, PLAYERS_UNAVAILABLE } from "./errors";
import {
  lineupRowSchema,
  MAX_STARTERS,
  minuteRangeError,
  SHIRT_NUMBER_ERROR,
  shirtNumberUsedBy,
  substitutionSchema,
  tooManyStarters,
  type LineupRowInput,
  type SubstitutionInput,
} from "./fields";

/**
 * Lineups and substitutions (SQUAD04, SQUAD05, SQUAD06, SQUAD09;
 * docs/build/design/C06.md, Surface 4). One Lineup row per selected player:
 * starters come on at 0 s, substitutes have no startedAt until they come on.
 * A substitution is stored on the rows themselves: the player going off gets
 * endedAt, the one coming on gets startedAt and replacesLineupId. Minutes
 * played come from those times (src/lib/match-clock.ts, minutesPlayed).
 *
 * Every write re-reads the players on the server (AUTH06): a departed player,
 * another team's player or another organisation's player is refused, whatever
 * the picker showed. A departed player's existing row is kept as it is
 * (SQUAD09). Lineup shirt numbers may differ from squad numbers (SQUAD04).
 * Lineups lock once the match is in review. Audit rows carry ids and counts.
 */

const PLAYER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  isPlaceholder: true,
  squadNumber: true,
  position: true,
  clubStatus: true,
} as const;

export type LineupPlayer = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  isPlaceholder: boolean;
  squadNumber: number | null;
  position: string | null;
  clubStatus: ClubStatus;
};

export type LineupRow = {
  id: string;
  teamId: string;
  playerId: string;
  shirtNumber: number;
  position: string | null;
  isStarter: boolean;
  startedAt: number | null;
  endedAt: number | null;
  replacesLineupId: string | null;
  player: LineupPlayer;
};

const ROW_SELECT = {
  id: true,
  teamId: true,
  playerId: true,
  shirtNumber: true,
  position: true,
  isStarter: true,
  startedAt: true,
  endedAt: true,
  replacesLineupId: true,
  player: { select: PLAYER_SELECT },
} as const;

/** One substitution: who went off, who came on (null: no replacement), and the minute. */
export type Substitution = {
  minute: number;
  off: LineupRow;
  on: LineupRow | null;
};

/** "#9 Sipho Dlamini": a lineup row in substitution lists and errors. */
export function rowLabel(row: Pick<LineupRow, "shirtNumber" | "player">): string {
  return `#${row.shirtNumber} ${playerName(row.player)}`;
}

/** Every row that went off is one substitution, paired with the row that replaced it. */
export function substitutionsOf(rows: LineupRow[]): Substitution[] {
  return rows
    .filter((r) => r.endedAt !== null)
    .map((off) => ({
      minute: Math.round(off.endedAt! / 60),
      off,
      on: rows.find((r) => r.replacesLineupId === off.id) ?? null,
    }))
    .sort((a, b) => a.minute - b.minute || a.off.shirtNumber - b.off.shirtNumber);
}

type TeamRef = { id: string; name: string; season: string; isOpposition: boolean };

export type SideLineup = {
  side: "home" | "away";
  team: TeamRef;
  rows: LineupRow[];
  substitutions: Substitution[];
};

export type MatchLineups = {
  match: {
    id: string;
    status: MatchStatus;
    playedAt: Date;
    halfLengthMinutes: number;
    homeTeam: TeamRef;
    awayTeam: TeamRef;
  };
  home: SideLineup;
  away: SideLineup;
};

const TEAM_SELECT = { id: true, name: true, season: true, isOpposition: true } as const;

/** Both sides' lineups. Throws MatchError("not_found") for an unknown or foreign match. */
export async function getLineups(ctx: AuthContext, matchId: string): Promise<MatchLineups> {
  requireSquadOrg(ctx);
  const match = await ctx.db.match.findFirst({
    where: { id: matchId },
    select: {
      id: true,
      status: true,
      playedAt: true,
      halfLengthMinutes: true,
      homeTeam: { select: TEAM_SELECT },
      awayTeam: { select: TEAM_SELECT },
    },
  });
  if (!match) throw new MatchError("not_found");
  const rows = await ctx.db.lineup.findMany({
    where: { matchId, player: { ...consentVisibleTo({ kind: "club" }) } },
    select: ROW_SELECT,
  });
  const side = (s: "home" | "away", team: TeamRef): SideLineup => {
    const mine = rows.filter((r) => r.teamId === team.id);
    return { side: s, team, rows: mine, substitutions: substitutionsOf(mine) };
  };
  return { match, home: side("home", match.homeTeam), away: side("away", match.awayTeam) };
}

/** The players a side can pick: the team's active players (opposition placeholders included). */
export async function pickerFor(ctx: AuthContext, teamId: string): Promise<PlayerRow[]> {
  return activePlayers(ctx, { teamId });
}

type Tx = Parameters<Parameters<AuthContext["db"]["$transaction"]>[0]>[0];

/** The match, checked editable, and the side's team, checked to be in it. */
async function editableSide(tx: Tx, matchId: string, teamId: string) {
  const match = await tx.match.findFirst({
    where: { id: matchId },
    select: { status: true, halfLengthMinutes: true, homeTeamId: true, awayTeamId: true },
  });
  if (!match) throw new MatchError("not_found");
  if (isLocked(match.status)) {
    throw new MatchError("locked", lockedMessage("Lineups", match.status));
  }
  if (teamId !== match.homeTeamId && teamId !== match.awayTeamId) {
    throw new MatchError("not_found");
  }
  return match;
}

async function sideRows(tx: Tx, matchId: string, teamId: string): Promise<LineupRow[]> {
  return tx.lineup.findMany({
    where: { matchId, teamId, player: { ...consentVisibleTo({ kind: "club" }) } },
    select: ROW_SELECT,
  });
}

/**
 * The substitutions to undo, as off-row ids, when rows change: any that
 * involves a removed row, any whose substitute is now a starter, any whose
 * player going off is now a substitute; and, in a chain, any later
 * substitution of a player whose coming on was undone.
 */
function substitutionsToUndo(
  rows: LineupRow[],
  removed: Set<string>,
  nowStarter: Set<string>,
  nowSubstitute: Set<string>,
): Set<string> {
  const subs = substitutionsOf(rows);
  const undo = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of subs) {
      if (undo.has(s.off.id)) continue;
      const onUndone = s.on && (removed.has(s.on.id) || nowStarter.has(s.on.id));
      const offGone = removed.has(s.off.id) || nowSubstitute.has(s.off.id);
      // The player going off came on in a substitution that is being undone.
      const chained = s.off.replacesLineupId !== null && undo.has(s.off.replacesLineupId);
      if (onUndone || offGone || chained) {
        undo.add(s.off.id);
        grew = true;
      }
    }
  }
  return undo;
}

/**
 * Saves one side's lineup in one transaction (SQUAD05). `rows` lists the
 * selected players; anyone left out is removed from the lineup, and their
 * substitutions with them. Returns how many substitutions that removed.
 */
export async function saveLineup(
  ctx: AuthContext,
  matchId: string,
  teamId: string,
  input: LineupRowInput[],
): Promise<{ substitutionsRemoved: number }> {
  requireSquadOrg(ctx);
  const fieldErrors: Record<string, string> = {};
  const parsed: LineupRowInput[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (seen.has(raw.playerId)) continue;
    seen.add(raw.playerId);
    const r = lineupRowSchema.safeParse(raw);
    if (r.success) parsed.push(r.data);
    else fieldErrors[`${raw.playerId}.shirtNumber`] = SHIRT_NUMBER_ERROR;
  }
  if (Object.keys(fieldErrors).length) {
    throw new MatchError("invalid", "Check the highlighted rows.", undefined, fieldErrors);
  }

  try {
    return await ctx.db.$transaction(async (tx) => {
      await editableSide(tx, matchId, teamId);
      const existing = await sideRows(tx, matchId, teamId);
      // SQUAD09: a departed player's row stays as it is; input for it is ignored.
      const departed = existing.filter((r) => r.player.clubStatus === "departed");
      const departedIds = new Set(departed.map((r) => r.playerId));
      const wanted = parsed.filter((r) => !departedIds.has(r.playerId));

      // AUTH06: every chosen player is re-read: active, on this team, in this organisation.
      const players = await tx.player.findMany({
        where: {
          id: { in: wanted.map((r) => r.playerId) },
          teamId,
          ...ACTIVE_PLAYER,
          ...consentVisibleTo({ kind: "club" }),
        },
        select: PLAYER_SELECT,
      });
      if (players.length !== wanted.length) {
        throw new MatchError("player_unavailable", PLAYERS_UNAVAILABLE);
      }
      const byId = new Map(players.map((p) => [p.id, p]));
      // Placeholders wear their placeholder number.
      for (const r of wanted) {
        const p = byId.get(r.playerId)!;
        if (p.isPlaceholder && p.squadNumber !== null) r.shirtNumber = p.squadNumber;
      }

      const starters =
        wanted.filter((r) => r.isStarter).length + departed.filter((r) => r.isStarter).length;
      if (starters > MAX_STARTERS) {
        throw new MatchError("invalid", tooManyStarters(starters));
      }

      const holders = new Map<number, string[]>();
      const nameOf = new Map<string, string>();
      for (const r of departed) {
        holders.set(r.shirtNumber, [...(holders.get(r.shirtNumber) ?? []), r.playerId]);
        nameOf.set(r.playerId, playerName(r.player));
      }
      for (const r of wanted) {
        holders.set(r.shirtNumber, [...(holders.get(r.shirtNumber) ?? []), r.playerId]);
        nameOf.set(r.playerId, playerName(byId.get(r.playerId)!));
      }
      for (const r of wanted) {
        const others = holders.get(r.shirtNumber)!.filter((id) => id !== r.playerId);
        if (others.length) {
          fieldErrors[`${r.playerId}.shirtNumber`] = shirtNumberUsedBy(
            r.shirtNumber,
            nameOf.get(others[0]!)!,
          );
        }
      }
      if (Object.keys(fieldErrors).length) {
        throw new MatchError("invalid", "Check the highlighted rows.", undefined, fieldErrors);
      }

      const current = existing.filter((r) => !departedIds.has(r.playerId));
      const byPlayer = new Map(current.map((r) => [r.playerId, r]));
      const wantedIds = new Set(wanted.map((r) => r.playerId));
      const removed = current.filter((r) => !wantedIds.has(r.playerId));
      const created = wanted.filter((r) => !byPlayer.has(r.playerId));
      const updated = wanted
        .map((r) => ({ input: r, row: byPlayer.get(r.playerId) }))
        .filter(
          (x): x is { input: LineupRowInput; row: LineupRow } =>
            !!x.row &&
            (x.row.shirtNumber !== x.input.shirtNumber ||
              x.row.position !== x.input.position ||
              x.row.isStarter !== x.input.isStarter),
        );

      const nowStarter = new Set(
        updated.filter((u) => u.input.isStarter && !u.row.isStarter).map((u) => u.row.id),
      );
      const nowSubstitute = new Set(
        updated.filter((u) => !u.input.isStarter && u.row.isStarter).map((u) => u.row.id),
      );
      const undo = substitutionsToUndo(
        existing,
        new Set(removed.map((r) => r.id)),
        nowStarter,
        nowSubstitute,
      );
      for (const offId of undo) {
        const on = existing.find((r) => r.replacesLineupId === offId);
        if (on) {
          await tx.lineup.update({
            where: { id: on.id },
            data: { startedAt: null, endedAt: null, replacesLineupId: null },
          });
        }
        await tx.lineup.update({ where: { id: offId }, data: { endedAt: null } });
      }

      if (removed.length) {
        await tx.lineup.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
      }
      // Numbers may swap between rows: move changed rows out of 1 to 99 first,
      // so the unique (match, team, shirt number) index never sees a clash.
      const renumbered = updated.filter((u) => u.row.shirtNumber !== u.input.shirtNumber);
      for (const [i, u] of renumbered.entries()) {
        await tx.lineup.update({ where: { id: u.row.id }, data: { shirtNumber: 1000 + i } });
      }
      for (const u of updated) {
        await tx.lineup.update({
          where: { id: u.row.id },
          data: {
            shirtNumber: u.input.shirtNumber,
            position: u.input.position,
            isStarter: u.input.isStarter,
            ...(nowStarter.has(u.row.id) && { startedAt: 0, replacesLineupId: null }),
            ...(nowSubstitute.has(u.row.id) && { startedAt: null, endedAt: null }),
          },
        });
      }
      if (created.length) {
        await tx.lineup.createMany({
          data: created.map((r) => ({
            organisationId: ctx.organisationId,
            matchId,
            teamId,
            playerId: r.playerId,
            shirtNumber: r.shirtNumber,
            position: r.position,
            isStarter: r.isStarter,
            startedAt: r.isStarter ? 0 : null,
          })),
        });
      }

      await audit(
        {
          organisationId: ctx.organisationId,
          actorUserId: ctx.user.id,
          action: "lineup.updated",
          targetType: "Match",
          targetId: matchId,
          metadata: {
            teamId,
            added: created.length,
            removed: removed.length,
            updated: updated.length,
            substitutionsRemoved: undo.size,
          },
        },
        asTransactionClient(tx),
      );
      return { substitutionsRemoved: undo.size };
    });
  } catch (err) {
    if (prismaErrorCode(err) === "P2002") {
      throw new MatchError(
        "invalid",
        "Two players have the same shirt number. Check the shirt numbers and save again.",
      );
    }
    throw err;
  }
}

/**
 * Records a substitution (SQUAD06) at a minute from 1 to 2 x half + 15. The
 * player going off must be on the pitch then; the one coming on must be an
 * unused substitute. onLineupId null: off with no replacement (injury or red
 * card). The guarded updates refuse a concurrent change.
 */
export async function addSubstitution(
  ctx: AuthContext,
  matchId: string,
  input: SubstitutionInput,
): Promise<void> {
  requireSquadOrg(ctx);
  const data = substitutionSchema.parse(input);
  await ctx.db.$transaction(async (tx) => {
    const match = await editableSide(tx, matchId, data.teamId);
    const max = maxSubstitutionMinute(match.halfLengthMinutes);
    if (data.minute < 1 || data.minute > max) {
      throw new MatchError("invalid", minuteRangeError(max), "minute");
    }
    const rows = await sideRows(tx, matchId, data.teamId);
    const at = data.minute * 60;
    const off = rows.find((r) => r.id === data.offLineupId);
    if (!off) throw new MatchError("invalid", "Choose the player who came off.", "offLineupId");
    if (off.startedAt === null || off.startedAt >= at || off.endedAt !== null) {
      throw new MatchError(
        "not_on_pitch",
        `${rowLabel(off)} was not on the pitch at ${data.minute} min.`,
        "offLineupId",
      );
    }
    const on = data.onLineupId ? rows.find((r) => r.id === data.onLineupId) : null;
    if (data.onLineupId && (!on || on.id === off.id || on.isStarter)) {
      throw new MatchError("invalid", "Choose who came on, or No replacement.", "onLineupId");
    }
    if (on && on.startedAt !== null) {
      throw new MatchError("already_on", `${rowLabel(on)} has already come on.`, "onLineupId");
    }
    const offDone = await tx.lineup.updateMany({
      where: { id: off.id, endedAt: null },
      data: { endedAt: at },
    });
    const onDone = on
      ? await tx.lineup.updateMany({
          where: { id: on.id, startedAt: null },
          data: { startedAt: at, replacesLineupId: off.id },
        })
      : { count: 1 };
    if (offDone.count !== 1 || onDone.count !== 1) {
      throw new MatchError(
        "invalid",
        "This lineup changed meanwhile. Reload the page and try again.",
      );
    }
    await audit(
      {
        organisationId: ctx.organisationId,
        actorUserId: ctx.user.id,
        action: "lineup.substitution_added",
        targetType: "Match",
        targetId: matchId,
        metadata: {
          teamId: data.teamId,
          offLineupId: off.id,
          onLineupId: on?.id ?? null,
          minute: data.minute,
        },
      },
      asTransactionClient(tx),
    );
  });
}

/**
 * Undoes a substitution, given the row that went off. Refused while the
 * player who came on has gone off again later: that substitution goes first.
 */
export async function removeSubstitution(
  ctx: AuthContext,
  matchId: string,
  { teamId, offLineupId }: { teamId: string; offLineupId: string },
): Promise<{ minute: number }> {
  requireSquadOrg(ctx);
  return ctx.db.$transaction(async (tx) => {
    await editableSide(tx, matchId, teamId);
    const rows = await sideRows(tx, matchId, teamId);
    const off = rows.find((r) => r.id === offLineupId && r.endedAt !== null);
    if (!off) throw new MatchError("not_found");
    const on = rows.find((r) => r.replacesLineupId === off.id);
    if (on && on.endedAt !== null) {
      throw new MatchError(
        "later_substitution",
        `Remove the substitution at ${Math.round(on.endedAt / 60)} min first.`,
      );
    }
    if (on) {
      await tx.lineup.update({
        where: { id: on.id },
        data: { startedAt: null, replacesLineupId: null },
      });
    }
    await tx.lineup.update({ where: { id: off.id }, data: { endedAt: null } });
    const minute = Math.round(off.endedAt! / 60);
    await audit(
      {
        organisationId: ctx.organisationId,
        actorUserId: ctx.user.id,
        action: "lineup.substitution_removed",
        targetType: "Match",
        targetId: matchId,
        metadata: { teamId, offLineupId: off.id, onLineupId: on?.id ?? null, minute },
      },
      asTransactionClient(tx),
    );
    return { minute };
  });
}
