import type { Prisma } from "@/generated/prisma/client";
import { autoAcceptThresholds, eventStatusFor, type AutoAcceptThresholds } from "@/lib/auto-accept";
import { attributablePlayerIds } from "../consent/visibility";
import { rawDb } from "../db/raw";
import { markSucceeded, type JobRef } from "../processing/jobs";
import { moveToAwaitingReviewIfReady } from "../processing/readiness";
import { recordUsage } from "../usage/meter";
import type { CvEvent, CvResult, CvTrack } from "./contract";

/**
 * CV result ingest (C08; CV01, NFR06, NFR08): one validated result becomes
 * Track, TrackPoint and Event rows in one transaction, with the job marked
 * succeeded and the match moved on when every required job is done.
 *
 * The consent gate (NFR08, PRD "POPIA and privacy") sits here, before
 * anything is stored, and is re-checked just before commit
 * (recheckLinkedConsent). A track whose readable shirt number matches a lineup
 * player is a candidate link; attributablePlayerIds() decides. An attributable
 * player's track is linked. Any other candidate (no grant, withdrawn, or an
 * opposition placeholder, who has no consent) is discarded: no Track row, no
 * points, and its events keep only their team side, with no track, player or
 * position. Tracks with no lineup match are kept unlinked for the reviewer
 * (C11). The worker never sees names or lineups; it reports shirt numbers.
 *
 * Idempotent (NFR06): tracks are keyed on (jobId, trackIndex), points on
 * (matchId, trackId, tMs), events on (jobId, sourceKey), usage on its source,
 * and the job only moves from running. A second ingest of the same result
 * changes nothing: it finds the job settled and rolls back, and even forced
 * through, every insert skips. Counts are derived from the result, so the job
 * metadata is the same either way. Logs and metadata carry ids and counts,
 * never player ids.
 */

/** A shirt number read below this confidence never links a track. Draft (Q-038). */
export const TRACK_LINK_MIN_CONFIDENCE = 0.5;
const POINT_BATCH = 20_000;
const TX_TIMEOUT_MS = 10 * 60 * 1000;

export type IngestCounts = {
  tracks: number;
  linked: number;
  discarded: number;
  unlinked: number;
  points: number;
  events: number;
  autoAccepted: number;
  pendingReview: number;
};

export type IngestInput = {
  job: JobRef;
  videoId: string;
  result: CvResult;
  resultKey: string;
  resultBytes: number;
  resultSha256: string;
  attempt: number;
  provider: string;
  realtimeFactor: number | null;
  startupMs: number | null;
  now?: Date;
};

export type IngestOutcome = { ingested: boolean; counts: IngestCounts; matchReady: boolean };

type LineupRow = { teamId: string; shirtNumber: number; playerId: string };
type TrackPlan = {
  track: CvTrack;
  fate: "linked" | "unlinked" | "discarded";
  playerId: string | null;
};

/** The lineup player a track's shirt number names, or null. */
function candidateFor(
  track: CvTrack,
  sides: { home: string; away: string },
  lineup: LineupRow[],
): string | null {
  if (track.teamSide === "unknown" || track.shirtNumber === null) return null;
  if ((track.shirtConfidence ?? 0) < TRACK_LINK_MIN_CONFIDENCE) return null;
  const teamId = sides[track.teamSide];
  return (
    lineup.find((l) => l.teamId === teamId && l.shirtNumber === track.shirtNumber)?.playerId ?? null
  );
}

/** Decides each track's fate: linked, unlinked, or discarded at the consent gate. */
export async function planTracks(
  db: Prisma.TransactionClient,
  organisationId: string,
  matchId: string,
  tracks: CvTrack[],
): Promise<TrackPlan[]> {
  const match = await db.match.findFirstOrThrow({
    where: { id: matchId, organisationId },
    select: { homeTeamId: true, awayTeamId: true },
  });
  const lineup = await db.lineup.findMany({
    where: { organisationId, matchId },
    select: { teamId: true, shirtNumber: true, playerId: true },
  });
  const sides = { home: match.homeTeamId, away: match.awayTeamId };
  const candidates = tracks.map((t) => candidateFor(t, sides, lineup));
  const ids = [...new Set(candidates.filter((c): c is string => c !== null))];
  const allowed = await attributablePlayerIds(db, organisationId, ids);
  return tracks.map((track, i) => {
    const candidate = candidates[i] ?? null;
    if (candidate === null) return { track, fate: "unlinked", playerId: null };
    if (allowed.has(candidate)) return { track, fate: "linked", playerId: candidate };
    return { track, fate: "discarded", playerId: null };
  });
}

/**
 * The consent re-check just before commit (NFR08, CONS03). The plan reads
 * consent without a lock, because ingest then writes for minutes and a lock
 * held that long would time out every consent change for these players. A
 * withdrawal that commits after the plan has its purge run before these
 * tracks exist, so this re-reads consent under FOR SHARE and drops any
 * linked player now refused: their events lose track, player and position
 * first (the Event FK cascades from Track), then their tracks go, with the
 * points cascading. The lock lasts only until commit, milliseconds later: a
 * withdrawal in flight is waited for and seen here, and one that starts after
 * waits for this commit, so its purge sees the tracks. Returns the refused ids.
 */
export async function recheckLinkedConsent(
  db: Prisma.TransactionClient,
  organisationId: string,
  jobId: string,
  linkedIds: string[],
): Promise<Set<string>> {
  if (linkedIds.length === 0) return new Set();
  const ids = [...new Set(linkedIds)].sort();
  await db.$queryRaw`
    SELECT "id" FROM "Player"
     WHERE "organisationId" = ${organisationId} AND "id" = ANY(${ids}::text[])
     ORDER BY "id" FOR SHARE`;
  const allowed = await attributablePlayerIds(db, organisationId, ids);
  const refused = ids.filter((id) => !allowed.has(id));
  if (refused.length === 0) return new Set();
  await db.event.updateMany({
    where: { organisationId, jobId, track: { playerId: { in: refused } } },
    data: { trackId: null, playerId: null, pitchX: null, pitchY: null },
  });
  await db.track.deleteMany({ where: { organisationId, jobId, playerId: { in: refused } } });
  return new Set(refused);
}

/** A CV event's identity in its result (with the job id, the NFR06 key). */
export function sourceKey(e: CvEvent): string {
  return `${e.type}@${e.tMs}#${e.trackIndex ?? "none"}`;
}

function countsFor(plans: TrackPlan[], result: CvResult, t: AutoAcceptThresholds): IngestCounts {
  const kept = plans.filter((p) => p.fate !== "discarded");
  // A repeated identity is stored once (createMany skips it), so count it once.
  const unique = new Map<string, CvEvent>();
  for (const e of result.events) if (!unique.has(sourceKey(e))) unique.set(sourceKey(e), e);
  const statuses = [...unique.values()].map((e) => eventStatusFor(e.type, e.confidence, t));
  return {
    tracks: kept.length,
    linked: plans.filter((p) => p.fate === "linked").length,
    discarded: plans.filter((p) => p.fate === "discarded").length,
    unlinked: plans.filter((p) => p.fate === "unlinked").length,
    points: kept.reduce((n, p) => n + p.track.points.length, 0),
    events: unique.size,
    autoAccepted: statuses.filter((s) => s === "auto_accepted").length,
    pendingReview: statuses.filter((s) => s === "pending_review").length,
  };
}

/** Thrown inside the transaction to roll it back when the job is no longer running. */
class Settled extends Error {}

export async function ingestCvResult(input: IngestInput): Promise<IngestOutcome> {
  const { job, result, videoId } = input;
  const { organisationId, matchId } = job;
  const now = input.now ?? new Date();
  let outcome: IngestOutcome | undefined;
  try {
    await rawDb.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT 1 FROM "Match" WHERE "id" = ${matchId} AND "organisationId" = ${organisationId} FOR UPDATE`;
        const org = await tx.organisation.findUniqueOrThrow({
          where: { id: organisationId },
          select: { settings: true },
        });
        const thresholds = autoAcceptThresholds(org.settings);
        const plans = await planTracks(tx, organisationId, matchId, result.tracks);

        // Tracks: retained ones only (NFR08).
        const kept = plans.filter((p) => p.fate !== "discarded");
        await tx.track.createMany({
          data: kept.map((p) => ({
            organisationId,
            matchId,
            jobId: job.id,
            trackIndex: p.track.trackIndex,
            teamSide: p.track.teamSide,
            shirtNumber: p.track.shirtNumber,
            shirtConfidence: p.track.shirtConfidence,
            playerId: p.playerId,
            linkConfidence: p.playerId ? p.track.shirtConfidence : null,
            linkedBy: p.playerId ? "cv" : null,
          })),
          skipDuplicates: true,
        });
        const rows = await tx.track.findMany({
          where: { organisationId, jobId: job.id },
          select: { id: true, trackIndex: true, playerId: true },
        });
        const byIndex = new Map(rows.map((r) => [r.trackIndex, r]));

        // Points, in batches through unnest (about 600,000 for a full match).
        const points: { trackId: string; tMs: number; x: number; y: number }[] = [];
        for (const p of kept) {
          const trackId = byIndex.get(p.track.trackIndex)!.id;
          for (const pt of p.track.points) points.push({ trackId, tMs: pt.tMs, x: pt.x, y: pt.y });
        }
        for (let i = 0; i < points.length; i += POINT_BATCH) {
          const batch = points.slice(i, i + POINT_BATCH);
          await tx.$executeRaw`
            INSERT INTO "TrackPoint" ("organisationId", "matchId", "trackId", "tMs", "x", "y")
            SELECT ${organisationId}, ${matchId}, t.track, t.tms, t.x, t.y
            FROM unnest(
              ${batch.map((b) => b.trackId)}::text[],
              ${batch.map((b) => b.tMs)}::int[],
              ${batch.map((b) => b.x)}::real[],
              ${batch.map((b) => b.y)}::real[]
            ) AS t(track, tms, x, y)
            ON CONFLICT DO NOTHING`;
        }

        // Events: a discarded track's events keep their team side only.
        const fateByIndex = new Map(plans.map((p) => [p.track.trackIndex, p]));
        await tx.event.createMany({
          data: result.events.map((e) => {
            const plan = e.trackIndex === null ? undefined : fateByIndex.get(e.trackIndex);
            const discarded = plan?.fate === "discarded";
            const row = e.trackIndex === null || discarded ? undefined : byIndex.get(e.trackIndex);
            return {
              organisationId,
              matchId,
              jobId: job.id,
              sourceKey: sourceKey(e),
              type: e.type,
              status: eventStatusFor(e.type, e.confidence, thresholds),
              teamSide: plan?.track.teamSide ?? null,
              trackId: row?.id ?? null,
              playerId: row?.playerId ?? null,
              timestampMs: e.tMs,
              pitchX: discarded ? null : e.x,
              pitchY: discarded ? null : e.y,
              confidence: e.confidence,
              onTarget: e.type === "shot" ? (e.onTarget ?? null) : null,
              clipStartMs: e.clipStartMs,
              clipEndMs: e.clipEndMs,
            };
          }),
          skipDuplicates: true,
        });

        const refused = await recheckLinkedConsent(
          tx,
          organisationId,
          job.id,
          plans.flatMap((p) => (p.playerId ? [p.playerId] : [])),
        );
        const final = plans.map((p): TrackPlan =>
          p.playerId && refused.has(p.playerId) ? { ...p, fate: "discarded", playerId: null } : p,
        );
        const counts = countsFor(final, result, thresholds);

        await recordUsage(
          {
            organisationId,
            metric: "storage_bytes",
            quantity: input.resultBytes,
            sourceType: "CvResult",
            sourceId: `${job.id}:${input.attempt}`,
            metadata: { matchId, processingJobId: job.id },
          },
          tx,
        );

        const { detector, tracker, events } = result.modelVersions;
        await tx.processingJob.updateMany({
          where: { id: job.id, organisationId, status: "running" },
          data: { modelVersion: `${detector}+${tracker}+${events}`, gpuProvider: input.provider },
        });
        const metadata = {
          resultKey: input.resultKey,
          resultSha256: input.resultSha256,
          schemaVersion: result.schemaVersion,
          modelVersions: result.modelVersions,
          warnings: result.warnings,
          counts,
          thresholds,
          realtimeFactor: input.realtimeFactor,
          startupMs: input.startupMs,
        };
        if (!(await markSucceeded(tx, job, metadata, now))) throw new Settled();
        const matchReady = await moveToAwaitingReviewIfReady(tx, {
          organisationId,
          matchId,
          videoId,
        });
        outcome = { ingested: true, counts, matchReady };
      },
      { timeout: TX_TIMEOUT_MS, maxWait: 30_000 },
    );
  } catch (err) {
    if (!(err instanceof Settled)) throw err;
    return { ingested: false, counts: emptyCounts(), matchReady: false };
  }
  return outcome!;
}

function emptyCounts(): IngestCounts {
  return {
    tracks: 0,
    linked: 0,
    discarded: 0,
    unlinked: 0,
    points: 0,
    events: 0,
    autoAccepted: 0,
    pendingReview: 0,
  };
}
