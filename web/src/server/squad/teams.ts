import "server-only";
import type { AuthContext } from "../auth/session";
import { audit } from "../audit";
import { isTeamNameViolation, prismaErrorCode, TeamError, type TeamUsage } from "./errors";
import { joinAnd, teamKindField, teamSchema, type TeamInput } from "./fields";
import { asTransactionClient } from "./tx";

/**
 * Teams of the active organisation (SQUAD01, SQUAD07). One Team row is one
 * team in one season. Opposition teams (isOpposition) hold unnamed
 * placeholders only. Every read and write goes through the scoped client.
 * Audit rows carry ids and field names only.
 */

export { TeamError };

export type TeamSummary = {
  id: string;
  name: string;
  ageGroup: string | null;
  gender: string | null;
  season: string;
  isOpposition: boolean;
  /** Active players; for an opposition team, its placeholders. */
  activeCount: number;
};

const SUMMARY_SELECT = {
  id: true,
  name: true,
  ageGroup: true,
  gender: true,
  season: true,
  isOpposition: true,
  _count: { select: { players: { where: { clubStatus: "active" as const } } } },
};

type SummaryRow = Omit<TeamSummary, "activeCount"> & { _count: { players: number } };

function toSummary({ _count, ...t }: SummaryRow): TeamSummary {
  return { ...t, activeCount: _count.players };
}

/** Season newest first, then name: the order of every team list and select. */
export function compareTeams(a: { season: string; name: string }, b: typeof a): number {
  return b.season.localeCompare(a.season) || a.name.localeCompare(b.name, "en-ZA");
}

/** Own and opposition teams, each by season (newest first), then name. */
export async function listTeams(
  ctx: AuthContext,
): Promise<{ own: TeamSummary[]; opposition: TeamSummary[] }> {
  const rows = await ctx.db.team.findMany({ select: SUMMARY_SELECT });
  const teams = rows.map(toSummary).sort(compareTeams);
  return {
    own: teams.filter((t) => !t.isOpposition),
    opposition: teams.filter((t) => t.isOpposition),
  };
}

export type TeamDetail = TeamSummary & {
  departedCount: number;
  matchCount: number;
  lineupCount: number;
  /** Shirt numbers of active players, ascending (the opposition placeholder list). */
  numbers: number[];
};

/** One team with its counts. Throws TeamError("not_found") for an unknown or foreign id. */
export async function getTeam(ctx: AuthContext, teamId: string): Promise<TeamDetail> {
  const team = await ctx.db.team.findFirst({
    where: { id: teamId },
    select: {
      ...SUMMARY_SELECT,
      _count: {
        select: {
          players: { where: { clubStatus: "active" as const } },
          homeMatches: true,
          awayMatches: true,
          lineups: true,
        },
      },
    },
  });
  if (!team) throw new TeamError("not_found");
  const [departedCount, numbered] = await Promise.all([
    ctx.db.player.count({ where: { teamId, clubStatus: "departed" } }),
    ctx.db.player.findMany({
      where: { teamId, clubStatus: "active", squadNumber: { not: null } },
      select: { squadNumber: true },
      orderBy: { squadNumber: "asc" },
    }),
  ]);
  const { _count, ...rest } = team;
  return {
    ...rest,
    activeCount: _count.players,
    departedCount,
    matchCount: _count.homeMatches + _count.awayMatches,
    lineupCount: _count.lineups,
    numbers: numbered.map((p) => p.squadNumber!),
  };
}

/** What keeps a team from being deleted: every player (departed too), match and lineup. */
export function teamUsage(t: TeamDetail): TeamUsage {
  return {
    players: t.activeCount + t.departedCount,
    matches: t.matchCount,
    lineups: t.lineupCount,
  };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "You cannot delete this team because it has 18 players and 2 matches. …"
 * Only non-zero counts are listed. Opposition players are placeholders.
 */
export function inUseMessage(usage: TeamUsage, isOpposition: boolean): string {
  const parts = [
    usage.players &&
      (isOpposition
        ? count(usage.players, "placeholder player", "placeholder players")
        : count(usage.players, "player", "players")),
    usage.matches && count(usage.matches, "match", "matches"),
    usage.lineups && count(usage.lineups, "lineup", "lineups"),
  ].filter((p): p is string => Boolean(p));
  return `You cannot delete this team because it has ${joinAnd(parts)}. Departed players count too, because their history stays with the team.`;
}

async function assertNameFree(
  ctx: AuthContext,
  name: string,
  season: string,
  exceptId?: string,
): Promise<void> {
  const clash = await ctx.db.team.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      season,
      ...(exceptId && { id: { not: exceptId } }),
    },
    select: { id: true },
  });
  if (clash) throw new TeamError("duplicate_name");
}

/** Creates a team. The kind (own or opposition) is fixed from here on. */
export async function createTeam(
  ctx: AuthContext,
  input: TeamInput,
  kind: "own" | "opposition" = "own",
): Promise<TeamSummary> {
  const data = teamSchema.parse(input);
  const isOpposition = teamKindField.parse(kind) === "opposition";
  await assertNameFree(ctx, data.name, data.season);
  let team;
  try {
    team = await ctx.db.team.create({
      data: { ...data, isOpposition, organisationId: ctx.organisationId },
      select: SUMMARY_SELECT,
    });
  } catch (err) {
    if (isTeamNameViolation(err)) throw new TeamError("duplicate_name");
    throw err;
  }
  await audit({
    organisationId: ctx.organisationId,
    actorUserId: ctx.user.id,
    action: "team.create",
    targetType: "Team",
    targetId: team.id,
    metadata: { isOpposition },
  });
  return toSummary(team);
}

/** Saves name, age group, gender and season. Audits the changed field names; no change writes nothing. */
export async function updateTeam(
  ctx: AuthContext,
  teamId: string,
  input: TeamInput,
): Promise<{ changed: string[] }> {
  const data = teamSchema.parse(input);
  const team = await ctx.db.team.findFirst({
    where: { id: teamId },
    select: { name: true, ageGroup: true, gender: true, season: true },
  });
  if (!team) throw new TeamError("not_found");
  const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => data[k] !== team[k]);
  if (changed.length === 0) return { changed };
  if (changed.includes("name") || changed.includes("season")) {
    await assertNameFree(ctx, data.name, data.season, teamId);
  }
  try {
    await ctx.db.team.update({
      where: { id: teamId },
      data: Object.fromEntries(changed.map((k) => [k, data[k]])),
    });
  } catch (err) {
    if (isTeamNameViolation(err)) throw new TeamError("duplicate_name");
    throw err;
  }
  await audit({
    organisationId: ctx.organisationId,
    actorUserId: ctx.user.id,
    action: "team.update",
    targetType: "Team",
    targetId: teamId,
    metadata: { changed },
  });
  return { changed };
}

/**
 * Deletes a team with no players (active or departed), matches or lineups.
 * The check, the delete and the audit row run in one transaction, so a player
 * added meanwhile either blocks the delete or is refused by the foreign key.
 */
export async function deleteTeam(ctx: AuthContext, teamId: string): Promise<{ name: string }> {
  try {
    return await deleteTeamOnce(ctx, teamId);
  } catch (err) {
    // A player, match or lineup arrived between the count and the delete.
    if (prismaErrorCode(err) === "P2003") {
      const team = await getTeam(ctx, teamId);
      throw new TeamError("in_use", { usage: teamUsage(team), isOpposition: team.isOpposition });
    }
    throw err;
  }
}

async function deleteTeamOnce(ctx: AuthContext, teamId: string): Promise<{ name: string }> {
  return ctx.db.$transaction(async (tx) => {
    const team = await tx.team.findFirst({
      where: { id: teamId },
      select: {
        name: true,
        season: true,
        isOpposition: true,
        _count: { select: { players: true, homeMatches: true, awayMatches: true, lineups: true } },
      },
    });
    if (!team) throw new TeamError("not_found");
    const usage: TeamUsage = {
      players: team._count.players,
      matches: team._count.homeMatches + team._count.awayMatches,
      lineups: team._count.lineups,
    };
    if (usage.players + usage.matches + usage.lineups > 0) {
      throw new TeamError("in_use", { usage, isOpposition: team.isOpposition });
    }
    await tx.team.delete({ where: { id: teamId } });
    await audit(
      {
        organisationId: ctx.organisationId,
        actorUserId: ctx.user.id,
        action: "team.delete",
        targetType: "Team",
        targetId: teamId,
      },
      asTransactionClient(tx),
    );
    return { name: team.name };
  });
}
