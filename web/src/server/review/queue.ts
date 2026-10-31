import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { CLIPS_ONLY_WINDOW_MS, compareQueue, isClaimLive, queueSection } from "@/lib/review-rules";
import type { ReviewerContext } from "../auth/reviewer";
import { rawDb } from "../db/raw";
import { limitFor } from "../entitlements";
import { withinLimit } from "../entitlements/resolve";
import { SCOUT_NETWORK_ORG_ID } from "../scouts/network";
import { conflictReasons, loadDeclarations, loadMatchFacts } from "./conflicts";

/**
 * The shared review queue (REVIEW01, REVIEW13; A-2, A-3). It reads across
 * organisations, so it uses the raw client, and returns match-level facts
 * only: club and team names, age group, competition, date, length, the count
 * of events to check and the footage expiry. Never venue, players or lineups.
 * Conflicts are worked out on the server and reach the page as one boolean.
 */

/** The queue is capped for the pilot (A-2); no pagination. */
export const QUEUE_CAP = 200;

/** Matches the queue can list: an active academy's or club's (not the Lab, the scout network, a suspended club). */
const QUEUE_ORGANISATION = {
  status: "active",
  type: { in: ["academy", "club"] },
} satisfies Prisma.OrganisationWhereInput;

const ROW_SELECT = {
  id: true,
  organisationId: true,
  playedAt: true,
  competition: true,
  halfLengthMinutes: true,
  organisation: { select: { name: true } },
  homeTeam: { select: { name: true, ageGroup: true } },
  awayTeam: { select: { name: true, ageGroup: true } },
} as const satisfies Prisma.MatchSelect;

const VIDEO_SELECT = {
  id: true,
  rawExpiresAt: true,
  deletedAt: true,
  durationSec: true,
} as const satisfies Prisma.VideoSelect;

type MatchPart = Prisma.MatchGetPayload<{ select: typeof ROW_SELECT }>;
type VideoPart = Prisma.VideoGetPayload<{ select: typeof VIDEO_SELECT }>;

/** One match in the queue: match-level facts only (A-3). */
export type QueueRow = {
  matchId: string;
  organisationId: string;
  organisationName: string;
  playedAt: Date;
  competition: string | null;
  /** The home team's age group, else the away team's. */
  ageGroup: string | null;
  halfLengthMinutes: number;
  homeTeam: { name: string };
  awayTeam: { name: string };
  videoId: string;
  rawExpiresAt: Date;
  /** Raw footage gone (deleted, or past its expiry): clips only. */
  clipsOnly: boolean;
  durationSec: number | null;
  /** Events with status pending_review. */
  toCheck: number;
  /** The scout may not claim it (REVIEW02). Never says why. */
  conflicted: boolean;
};

/** One of the scout's own live claims. */
export type ClaimRow = QueueRow & { claimId: string; claimedAt: Date; claimExpiresAt: Date };

export type ReviewQueue = {
  mine: ClaimRow[];
  waiting: QueueRow[];
  clipsOnly: QueueRow[];
  /** review_claims_active, read from the scout network (A-7). Infinity when unlimited. */
  claimLimit: number;
  activeClaims: number;
  /** True when one more claim would pass the limit. */
  atLimit: boolean;
  /** True when the queue hit QUEUE_CAP. */
  capped: boolean;
};

function toRow(
  m: MatchPart,
  v: VideoPart & { rawExpiresAt: Date },
  now: Date,
  toCheck: number,
  conflicted: boolean,
): QueueRow {
  return {
    matchId: m.id,
    organisationId: m.organisationId,
    organisationName: m.organisation.name,
    playedAt: m.playedAt,
    competition: m.competition,
    ageGroup: m.homeTeam.ageGroup ?? m.awayTeam.ageGroup ?? null,
    halfLengthMinutes: m.halfLengthMinutes,
    homeTeam: { name: m.homeTeam.name },
    awayTeam: { name: m.awayTeam.name },
    videoId: v.id,
    rawExpiresAt: v.rawExpiresAt,
    clipsOnly: queueSection(v, now) !== "waiting",
    durationSec: v.durationSec,
    toCheck,
    conflicted,
  };
}

/** pending_review counts per match. */
async function pendingCounts(matchIds: string[]): Promise<Map<string, number>> {
  if (matchIds.length === 0) return new Map();
  const groups = await rawDb.event.groupBy({
    by: ["matchId"],
    where: { matchId: { in: matchIds }, status: "pending_review" },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.matchId, g._count._all]));
}

/** The claim limit every reviewer gets, read from the scout network (A-7, Q-050). */
export async function claimLimit(): Promise<number> {
  return limitFor(SCOUT_NETWORK_ORG_ID, "review_claims_active");
}

/** The caller's live claims, soonest footage expiry first. */
async function liveClaims(ctx: ReviewerContext, now: Date): Promise<ClaimRow[]> {
  const claims = await rawDb.reviewClaim.findMany({
    where: { scoutUserId: ctx.user.id, status: "active", expiresAt: { gt: now } },
    select: {
      id: true,
      claimedAt: true,
      expiresAt: true,
      match: { select: ROW_SELECT },
      video: { select: VIDEO_SELECT },
    },
  });
  const counts = await pendingCounts(claims.map((c) => c.match.id));
  const rows: ClaimRow[] = [];
  for (const c of claims) {
    const rawExpiresAt = c.video.rawExpiresAt;
    if (!rawExpiresAt) continue;
    rows.push({
      ...toRow(c.match, { ...c.video, rawExpiresAt }, now, counts.get(c.match.id) ?? 0, false),
      claimId: c.id,
      claimedAt: c.claimedAt,
      claimExpiresAt: c.expiresAt,
    });
  }
  return rows.sort(compareRows);
}

const compareRows = (a: QueueRow, b: QueueRow) =>
  compareQueue(
    { id: a.matchId, playedAt: a.playedAt, rawExpiresAt: a.rawExpiresAt },
    { id: b.matchId, playedAt: b.playedAt, rawExpiresAt: b.rawExpiresAt },
  );

/**
 * Claimable matches with an accepted video still in the queue window (raw
 * footage, or clips only), soonest expiry first. `matchId` narrows to one.
 * Awaiting review, or In review whose claim has run out but has not been
 * swept yet: lazy expiry (A-5), so the match is listed at the 48-hour mark
 * and claimMatch() expires the stale claim in its own transaction.
 */
async function claimableVideos(now: Date, matchId?: string) {
  return rawDb.video.findMany({
    where: {
      status: "accepted",
      rawExpiresAt: { gt: new Date(now.getTime() - CLIPS_ONLY_WINDOW_MS) },
      match: {
        status: { in: ["awaiting_review", "in_review"] },
        reviewClaims: { none: { status: "active", expiresAt: { gt: now } } },
        organisation: QUEUE_ORGANISATION,
        ...(matchId && { id: matchId }),
      },
    },
    orderBy: [{ rawExpiresAt: "asc" }, { id: "asc" }],
    take: QUEUE_CAP,
    select: { ...VIDEO_SELECT, match: { select: ROW_SELECT } },
  });
}

/** Rows for these videos, with counts and the caller's conflicts. */
async function rowsFor(
  ctx: ReviewerContext,
  videos: Awaited<ReturnType<typeof claimableVideos>>,
  now: Date,
): Promise<QueueRow[]> {
  const listed = videos.filter(
    (v): v is typeof v & { rawExpiresAt: Date } =>
      v.rawExpiresAt !== null && queueSection(v, now) !== "gone",
  );
  const matches = listed.map((v) => ({ id: v.match.id, organisationId: v.match.organisationId }));
  const counts = await pendingCounts(matches.map((m) => m.id));
  const scout = await loadDeclarations(ctx.user.id, now);
  const facts = await loadMatchFacts(matches);
  return listed.map((v) => {
    const f = facts.get(v.match.id);
    const conflicted = f ? conflictReasons(scout, f, now).conflicted : true;
    return toRow(v.match, v, now, counts.get(v.match.id) ?? 0, conflicted);
  });
}

/** The queue for this reviewer at `now` (docs/build/design/C10.md, Surface 1). */
export async function reviewQueue(
  ctx: ReviewerContext,
  { now = new Date() }: { now?: Date } = {},
): Promise<ReviewQueue> {
  const [mine, videos, limit] = await Promise.all([
    liveClaims(ctx, now),
    claimableVideos(now),
    claimLimit(),
  ]);
  const rows = (await rowsFor(ctx, videos, now)).sort(compareRows);
  return {
    mine,
    waiting: rows.filter((r) => !r.clipsOnly),
    clipsOnly: rows.filter((r) => r.clipsOnly),
    claimLimit: limit,
    activeClaims: mine.length,
    atLimit: !withinLimit(limit, mine.length),
    capped: videos.length >= QUEUE_CAP,
  };
}

export type QueueMatch = {
  row: QueueRow;
  claimLimit: number;
  atLimit: boolean;
};

/**
 * One match as the queue would list it, for the claim page, or null when it
 * is not claimable (unknown, claimed, not awaiting review, a suspended club,
 * the Lab, footage gone). The same answer for every case, so the page does
 * not reveal whether a match exists.
 */
export async function queueMatch(
  ctx: ReviewerContext,
  matchId: string,
  now = new Date(),
): Promise<QueueMatch | null> {
  const videos = await claimableVideos(now, matchId);
  const [row] = await rowsFor(ctx, videos, now);
  if (!row) return null;
  const limit = await claimLimit();
  const active = await rawDb.reviewClaim.count({
    where: { scoutUserId: ctx.user.id, status: "active", expiresAt: { gt: now } },
  });
  return { row, claimLimit: limit, atLimit: !withinLimit(limit, active) };
}

/** The caller's own live claim on this match, if any (the claim page redirects to it). */
export async function ownLiveClaimId(
  ctx: ReviewerContext,
  matchId: string,
  now = new Date(),
): Promise<string | null> {
  const claim = await rawDb.reviewClaim.findFirst({
    where: { matchId, scoutUserId: ctx.user.id, status: "active" },
    select: { id: true, status: true, expiresAt: true },
  });
  return claim && isClaimLive(claim, now) ? claim.id : null;
}

export { ROW_SELECT as QUEUE_MATCH_SELECT, VIDEO_SELECT as QUEUE_VIDEO_SELECT, toRow };
