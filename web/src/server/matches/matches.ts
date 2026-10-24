import "server-only";
import type { MatchStatus, VideoStatus } from "@/generated/prisma/enums";
import { readValidation, type FootageValidation } from "@/lib/footage-rules";
import { teamLabel } from "@/lib/labels";
import { maxSubstitutionMinute, type Markers } from "@/lib/match-clock";
import type { AuthContext } from "../auth/session";
import { audit } from "../audit";
import { hasCapacity } from "../entitlements";
import { log } from "../log";
import { getBoss, QUEUES, type RetentionJob } from "../queue";
import { asTransactionClient } from "../squad/tx";
import { recordUsage, usageTotals } from "../usage/meter";
import { requireSquadOrg } from "./access";
import { CHOOSE_FROM_LIST, MatchError, ONE_SIDE_OWN } from "./errors";
import { matchSchema, type MatchData, type MatchInput } from "./fields";

/**
 * Matches of the active organisation (MATCH01, MATCH07, MATCH08;
 * docs/build/design/C06.md, Surfaces 1, 2 and 6). Every read and write goes
 * through the scoped client. Audit rows carry ids, counts and field names
 * only.
 */

export { MatchError };

/** The order of the status groups on /matches. */
export const STATUS_ORDER: readonly MatchStatus[] = [
  "draft",
  "uploading",
  "processing",
  "awaiting_review",
  "in_review",
  "published",
  "failed",
];

const LIVE_VIDEO: readonly VideoStatus[] = ["uploading", "probing", "accepted"];

type TeamRef = { id: string; name: string; season: string; isOpposition: boolean };

export type VideoSummary = {
  id: string;
  status: VideoStatus;
  fileName: string;
  sizeBytes: number;
  partSize: number;
  fingerprint: string;
  uploadedAt: Date | null;
  rawExpiresAt: Date | null;
  probedAt: Date | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  validation: FootageValidation | null;
  deletedAt: Date | null;
  markers: Markers;
};

export type MatchSummary = {
  id: string;
  status: MatchStatus;
  playedAt: Date;
  venue: string | null;
  competition: string | null;
  halfLengthMinutes: number;
  createdAt: Date;
  homeTeam: TeamRef;
  awayTeam: TeamRef;
  /** The live video (uploading, probing or accepted), else the newest attempt, else null. */
  video: VideoSummary | null;
};

const TEAM_SELECT = { id: true, name: true, season: true, isOpposition: true } as const;

const VIDEO_SELECT = {
  id: true,
  status: true,
  fileName: true,
  sizeBytes: true,
  partSize: true,
  fingerprint: true,
  uploadedAt: true,
  rawExpiresAt: true,
  probedAt: true,
  durationSec: true,
  width: true,
  height: true,
  fps: true,
  validation: true,
  deletedAt: true,
  kickoffMs: true,
  halfTimeMs: true,
  secondHalfKickoffMs: true,
  fullTimeMs: true,
  createdAt: true,
} as const;

const SUMMARY_SELECT = {
  id: true,
  status: true,
  playedAt: true,
  venue: true,
  competition: true,
  halfLengthMinutes: true,
  createdAt: true,
  homeTeam: { select: TEAM_SELECT },
  awayTeam: { select: TEAM_SELECT },
  videos: { select: VIDEO_SELECT, orderBy: { createdAt: "desc" as const } },
} as const;

type VideoRow = {
  id: string;
  status: VideoStatus;
  fileName: string;
  sizeBytes: bigint;
  partSize: number;
  fingerprint: string;
  uploadedAt: Date | null;
  rawExpiresAt: Date | null;
  probedAt: Date | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  validation: unknown;
  deletedAt: Date | null;
  kickoffMs: number | null;
  halfTimeMs: number | null;
  secondHalfKickoffMs: number | null;
  fullTimeMs: number | null;
};

export function toVideoSummary(v: VideoRow): VideoSummary {
  return {
    id: v.id,
    status: v.status,
    fileName: v.fileName,
    sizeBytes: Number(v.sizeBytes),
    partSize: v.partSize,
    fingerprint: v.fingerprint,
    uploadedAt: v.uploadedAt,
    rawExpiresAt: v.rawExpiresAt,
    probedAt: v.probedAt,
    durationSec: v.durationSec,
    width: v.width,
    height: v.height,
    fps: v.fps,
    validation: readValidation(v.validation),
    deletedAt: v.deletedAt,
    markers: {
      kickoffMs: v.kickoffMs,
      halfTimeMs: v.halfTimeMs,
      secondHalfKickoffMs: v.secondHalfKickoffMs,
      fullTimeMs: v.fullTimeMs,
    },
  };
}

/** The live video, else the newest attempt (rows come newest first). */
export function pickVideo(videos: VideoRow[]): VideoSummary | null {
  const v = videos.find((x) => LIVE_VIDEO.includes(x.status)) ?? videos[0];
  return v ? toVideoSummary(v) : null;
}

type SummaryRow = Omit<MatchSummary, "video"> & { videos: VideoRow[] };

function toSummary({ videos, ...m }: SummaryRow): MatchSummary {
  return { ...m, video: pickVideo(videos) };
}

/** Played newest first, then created newest first: the order inside each group. */
function compareMatches(a: MatchSummary, b: MatchSummary): number {
  return (
    b.playedAt.getTime() - a.playedAt.getTime() || b.createdAt.getTime() - a.createdAt.getTime()
  );
}

export type MatchGroup = { status: MatchStatus; matches: MatchSummary[] };

/**
 * Every match of the organisation, or of one team (home or away), grouped by
 * status in STATUS_ORDER. Groups without matches are left out.
 */
export async function listMatchesByStatus(
  ctx: AuthContext,
  { teamId }: { teamId?: string | null } = {},
): Promise<MatchGroup[]> {
  requireSquadOrg(ctx);
  const rows = await ctx.db.match.findMany({
    where: teamId ? { OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] } : {},
    select: SUMMARY_SELECT,
  });
  const matches = rows.map(toSummary).sort(compareMatches);
  return STATUS_ORDER.map((status) => ({
    status,
    matches: matches.filter((m) => m.status === status),
  })).filter((g) => g.matches.length > 0);
}

export type SideCounts = { starters: number; substitutes: number; substitutions: number };

export type MatchDetail = MatchSummary & {
  lineups: { home: SideCounts; away: SideCounts };
};

const emptyCounts = (): SideCounts => ({ starters: 0, substitutes: 0, substitutions: 0 });

/** One match with its video and lineup counts. Throws MatchError("not_found") for an unknown or foreign id. */
export async function getMatch(ctx: AuthContext, matchId: string): Promise<MatchDetail> {
  requireSquadOrg(ctx);
  const row = await ctx.db.match.findFirst({
    where: { id: matchId },
    select: {
      ...SUMMARY_SELECT,
      lineups: { select: { teamId: true, isStarter: true, endedAt: true } },
    },
  });
  if (!row) throw new MatchError("not_found");
  const { lineups, ...rest } = row;
  const match = toSummary(rest);
  const counts = { home: emptyCounts(), away: emptyCounts() };
  for (const l of lineups) {
    const side =
      l.teamId === match.homeTeam.id
        ? counts.home
        : l.teamId === match.awayTeam.id
          ? counts.away
          : null;
    if (!side) continue;
    if (l.isStarter) side.starters += 1;
    else side.substitutes += 1;
    // Each substitution ends one row: a player went off (SQUAD06).
    if (l.endedAt !== null) side.substitutions += 1;
  }
  return { ...match, lineups: counts };
}

/** The calendar month in South Africa that holds `now`, as [from, to). */
export function sastMonth(now = new Date()): { from: Date; to: Date } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")!.value);
  const m = Number(parts.find((p) => p.type === "month")!.value);
  const iso = (year: number, month: number) =>
    `${year}-${String(month).padStart(2, "0")}-01T00:00:00+02:00`;
  return {
    from: new Date(iso(y, m)),
    to: new Date(m === 12 ? iso(y + 1, 1) : iso(y, m + 1)),
  };
}

type Teams = { home: TeamRef; away: TeamRef };

/** Both teams are this organisation's, and at least one is an own team. */
async function resolveTeams(ctx: AuthContext, data: MatchData): Promise<Teams> {
  const teams = await ctx.db.team.findMany({
    where: { id: { in: [data.homeTeamId, data.awayTeamId] } },
    select: TEAM_SELECT,
  });
  const home = teams.find((t) => t.id === data.homeTeamId);
  const away = teams.find((t) => t.id === data.awayTeamId);
  const fieldErrors: Record<string, string> = {};
  if (!home) fieldErrors.homeTeamId = CHOOSE_FROM_LIST;
  if (!away) fieldErrors.awayTeamId = CHOOSE_FROM_LIST;
  if (home && away && home.isOpposition && away.isOpposition) {
    fieldErrors.awayTeamId = ONE_SIDE_OWN;
  }
  if (Object.keys(fieldErrors).length) {
    throw new MatchError("invalid", undefined, undefined, fieldErrors);
  }
  return { home: home!, away: away! };
}

/**
 * Creates a match (MATCH01) and records it in the usage meter. matches_per_month
 * (release v2) is checked and recorded in the audit row, never enforced in v0:
 * V201 enforces it. The usage row is written after the transaction commits,
 * because the scoped client refuses UsageEvent; its unique source key keeps it
 * to one row.
 */
export async function createMatch(ctx: AuthContext, input: MatchInput): Promise<{ id: string }> {
  requireSquadOrg(ctx);
  const data = matchSchema.parse(input);
  await resolveTeams(ctx, data);
  const used = await usageTotals(ctx.organisationId, sastMonth());
  const withinMonthlyLimit = await hasCapacity(
    ctx.organisationId,
    "matches_per_month",
    Number(used.matches),
  );
  if (!withinMonthlyLimit) {
    log.warn(
      { organisationId: ctx.organisationId },
      "matches_per_month exceeded (not enforced in v0)",
    );
  }
  const match = await ctx.db.$transaction(async (tx) => {
    const m = await tx.match.create({
      data: {
        organisationId: ctx.organisationId,
        homeTeamId: data.homeTeamId,
        awayTeamId: data.awayTeamId,
        playedAt: data.playedAt,
        venue: data.venue,
        competition: data.competition,
        halfLengthMinutes: data.halfLengthMinutes,
        createdByUserId: ctx.user.id,
      },
      select: { id: true },
    });
    await audit(
      {
        organisationId: ctx.organisationId,
        actorUserId: ctx.user.id,
        action: "match.created",
        targetType: "Match",
        targetId: m.id,
        metadata: {
          homeTeamId: data.homeTeamId,
          awayTeamId: data.awayTeamId,
          withinMonthlyLimit,
        },
      },
      asTransactionClient(tx),
    );
    return m;
  });
  await recordUsage({
    organisationId: ctx.organisationId,
    metric: "matches",
    quantity: 1,
    sourceType: "Match",
    sourceId: match.id,
  });
  return match;
}

const EDIT_FIELDS = [
  "homeTeamId",
  "awayTeamId",
  "playedAt",
  "venue",
  "competition",
  "halfLengthMinutes",
] as const;

const same = (a: unknown, b: unknown) =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

/**
 * Saves a match's fields. Editing is allowed at every status. A team may not
 * leave the match while its lineup has rows, and the half length may not end
 * the match before a recorded substitution. Audits changed field names; no
 * change writes nothing.
 */
export async function updateMatch(
  ctx: AuthContext,
  matchId: string,
  input: MatchInput,
): Promise<{ changed: string[] }> {
  requireSquadOrg(ctx);
  const data = matchSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const match = await tx.match.findFirst({
      where: { id: matchId },
      select: {
        homeTeamId: true,
        awayTeamId: true,
        playedAt: true,
        venue: true,
        competition: true,
        halfLengthMinutes: true,
        homeTeam: { select: TEAM_SELECT },
        awayTeam: { select: TEAM_SELECT },
        lineups: {
          select: { teamId: true, startedAt: true, endedAt: true, replacesLineupId: true },
        },
      },
    });
    if (!match) throw new MatchError("not_found");
    const changed = EDIT_FIELDS.filter((k) => !same(data[k], match[k]));
    if (changed.length === 0) return { changed };

    if (changed.includes("homeTeamId") || changed.includes("awayTeamId")) {
      await resolveTeams(ctx, data);
      const kept = new Set([data.homeTeamId, data.awayTeamId]);
      const fieldErrors: Record<string, string> = {};
      for (const [side, team, field] of [
        ["home", match.homeTeam, "homeTeamId"],
        ["away", match.awayTeam, "awayTeamId"],
      ] as const) {
        if (!kept.has(team.id) && match.lineups.some((l) => l.teamId === team.id)) {
          fieldErrors[field] =
            `Remove the ${side} lineup first. It lists players from ${teamLabel(team)}.`;
        }
      }
      if (Object.keys(fieldErrors).length) {
        throw new MatchError("team_in_use", undefined, undefined, fieldErrors);
      }
    }

    if (changed.includes("halfLengthMinutes")) {
      const latest = Math.max(
        0,
        ...match.lineups.flatMap((l) => [
          l.endedAt ?? 0,
          l.replacesLineupId ? (l.startedAt ?? 0) : 0,
        ]),
      );
      const minute = Math.round(latest / 60);
      if (minute > maxSubstitutionMinute(data.halfLengthMinutes)) {
        throw new MatchError(
          "invalid",
          `A substitution at ${minute} min is past the end of a 2 × ${data.halfLengthMinutes} min match. Remove it first.`,
          "halfLengthMinutes",
        );
      }
    }

    await tx.match.update({
      where: { id: matchId },
      data: Object.fromEntries(changed.map((k) => [k, data[k]])),
    });
    await audit(
      {
        organisationId: ctx.organisationId,
        actorUserId: ctx.user.id,
        action: "match.updated",
        targetType: "Match",
        targetId: matchId,
        metadata: { changed },
      },
      asTransactionClient(tx),
    );
    return { changed };
  });
}

/**
 * Deletes a match and everything derived from it (MATCH08). The rows go at
 * once in one transaction (lineups and videos cascade), audited with ids and
 * counts only. Object storage is purged by the retention worker
 * (src/worker/retention.ts), which aborts open uploads and deletes everything
 * under the match prefix: the one process that deletes footage (NFR32). That
 * it runs at once, before 7 days, is an open question (QUESTIONS.md, Q-025).
 */
export async function deleteMatch(ctx: AuthContext, matchId: string): Promise<void> {
  requireSquadOrg(ctx);
  const job = await ctx.db.$transaction(async (tx) => {
    const match = await tx.match.findFirst({
      where: { id: matchId },
      select: {
        id: true,
        _count: { select: { lineups: true } },
        videos: { select: { id: true, blobPath: true, s3UploadId: true, status: true } },
      },
    });
    if (!match) throw new MatchError("not_found");
    await tx.match.delete({ where: { id: matchId } });
    await audit(
      {
        organisationId: ctx.organisationId,
        actorUserId: ctx.user.id,
        action: "match.deleted",
        targetType: "Match",
        targetId: matchId,
        metadata: {
          lineups: match._count.lineups,
          videos: match.videos.length,
          videoIds: match.videos.map((v) => v.id),
        },
      },
      asTransactionClient(tx),
    );
    const retention: RetentionJob = {
      kind: "match_deleted",
      organisationId: ctx.organisationId,
      matchId,
      uploads: match.videos
        .filter((v) => v.status === "uploading" && v.s3UploadId)
        .map((v) => ({ key: v.blobPath, uploadId: v.s3UploadId! })),
    };
    return retention;
  });
  await enqueueRetention(job);
}

/**
 * Enqueues the purge after the deletion commits. A failure is logged: the
 * rows are already gone, and C17's daily sweep removes prefixes with no match.
 */
async function enqueueRetention(job: RetentionJob): Promise<void> {
  try {
    const boss = await getBoss();
    await boss.send(QUEUES.retention, job);
  } catch (err) {
    log.error(
      { err, organisationId: job.organisationId, matchId: job.matchId },
      "retention enqueue failed",
    );
  }
}
