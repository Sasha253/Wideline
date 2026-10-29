import "server-only";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import type {
  BenchmarkTagSource,
  ProcessingJobStatus,
  ProcessingJobType,
  VideoStatus,
} from "@/generated/prisma/enums";
import {
  AUTO_ACCEPT_DEFAULTS,
  autoAcceptThresholds,
  type AutoAcceptThresholds,
} from "@/lib/auto-accept";
import type { FootageValidation } from "@/lib/footage-rules";
import { isMatrix3, type Matrix3 } from "@/lib/homography";
import type { AuthContext } from "../auth/session";
import { cvStillKey } from "../matches/keys";
import { bucket, s3Internal } from "../storage";
import {
  matchRecall,
  RECALL_ROWS,
  type Detection,
  type MatchRecall,
  type RecallRow,
  type RecallRowType,
  type Tag,
} from "./recall";
import { reviewReadyDuration } from "./timings";

/**
 * The Lab's benchmark data (C09; Q-046, NFR01), read through the platform
 * admin's scoped client: Lab matches only. Ids, counts, times and model
 * versions; no player names.
 */

export type LabJob = {
  id: string;
  type: ProcessingJobType;
  status: ProcessingJobStatus;
  attempts: number;
  maxAttempts: number;
  modelVersion: string | null;
  finishedAt: Date | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
};

export type LabVideo = {
  id: string;
  status: VideoStatus;
  validation: FootageValidation | null;
  deletedAt: Date | null;
  uploadedAt: Date | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
};

const JOB_SELECT = {
  id: true,
  type: true,
  status: true,
  attempts: true,
  maxAttempts: true,
  modelVersion: true,
  finishedAt: true,
  errorMessage: true,
  metadata: true,
  videoId: true,
  queuedAt: true,
} as const;

const VIDEO_SELECT = {
  id: true,
  status: true,
  validation: true,
  deletedAt: true,
  uploadedAt: true,
  durationSec: true,
  width: true,
  height: true,
} as const;

/** "{detector}+{tracker}+{events}" split into its parts. */
export function versionParts(modelVersion: string | null): {
  detector: string;
  tracker: string | null;
  events: string | null;
} | null {
  if (!modelVersion) return null;
  const [detector, tracker, events] = modelVersion.split("+");
  return { detector: detector!, tracker: tracker ?? null, events: events ?? null };
}

export function isSynthetic(modelVersion: string | null): boolean {
  return versionParts(modelVersion)?.detector.startsWith("synthetic") ?? false;
}

function thresholdsOf(job: { metadata: unknown } | null): AutoAcceptThresholds {
  const t = (job?.metadata as { thresholds?: unknown } | null)?.thresholds;
  return t ? autoAcceptThresholds({ autoAccept: t }) : AUTO_ACCEPT_DEFAULTS;
}

function asJob(row: {
  id: string;
  type: ProcessingJobType;
  status: ProcessingJobStatus;
  attempts: number;
  maxAttempts: number;
  modelVersion: string | null;
  finishedAt: Date | null;
  errorMessage: string | null;
  metadata: unknown;
}): LabJob {
  return {
    ...row,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

async function detectionsOf(ctx: AuthContext, jobId: string): Promise<Detection[]> {
  const rows = await ctx.db.event.findMany({
    where: { jobId },
    select: { id: true, type: true, timestampMs: true, onTarget: true, confidence: true },
  });
  return rows;
}

async function tagsOf(
  ctx: AuthContext,
  matchId: string,
): Promise<(Tag & { source: BenchmarkTagSource; teamSide: "home" | "away" | "unknown" | null })[]> {
  return ctx.db.benchmarkTag.findMany({
    where: { matchId },
    orderBy: { timestampMs: "asc" },
    select: {
      id: true,
      type: true,
      timestampMs: true,
      onTarget: true,
      source: true,
      teamSide: true,
    },
  });
}

export type LabMatchRow = {
  id: string;
  home: string;
  away: string;
  competition: string | null;
  playedAt: Date;
  status: Awaited<ReturnType<AuthContext["db"]["match"]["findFirstOrThrow"]>>["status"];
  video: LabVideo | null;
  cv: LabJob | null;
  clips: LabJob | null;
  tagCount: number;
  /** Goal and shot rows, when there are tags and a succeeded cv job. */
  recall: RecallRow[] | null;
  readySec: number | null;
};

/** Every Lab match, newest first, with its footage, latest jobs, recall and time to review-ready. */
export async function labMatchRows(ctx: AuthContext): Promise<LabMatchRow[]> {
  const matches = await ctx.db.match.findMany({
    orderBy: { playedAt: "desc" },
    select: {
      id: true,
      status: true,
      playedAt: true,
      competition: true,
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  });
  const out: LabMatchRow[] = [];
  for (const m of matches) {
    const video = await ctx.db.video.findFirst({
      where: { matchId: m.id },
      orderBy: { createdAt: "desc" },
      select: VIDEO_SELECT,
    });
    const jobs = video
      ? await ctx.db.processingJob.findMany({ where: { videoId: video.id }, select: JOB_SELECT })
      : [];
    const cv = jobs.find((j) => j.type === "cv") ?? null;
    const clips = jobs.find((j) => j.type === "clips") ?? null;
    const tags = await tagsOf(ctx, m.id);
    let recall: RecallRow[] | null = null;
    if (tags.length && cv?.status === "succeeded") {
      const r = matchRecall(await detectionsOf(ctx, cv.id), tags, thresholdsOf(cv));
      recall = r.rows.filter((row) => row.type === "goal" || row.type === "shot");
    }
    out.push({
      id: m.id,
      home: m.homeTeam.name,
      away: m.awayTeam.name,
      competition: m.competition,
      playedAt: m.playedAt,
      status: m.status,
      video: video ? { ...video, validation: video.validation as FootageValidation | null } : null,
      cv: cv ? asJob(cv) : null,
      clips: clips ? asJob(clips) : null,
      tagCount: tags.length,
      recall,
      readySec: video ? reviewReadyDuration(video.uploadedAt, jobs) : null,
    });
  }
  return out;
}

export type LabCalibration = {
  id: string;
  source: "fallback" | "auto" | "manual";
  confidence: number;
  reprojectionErrorM: number | null;
  pointCount: number | null;
  createdAt: Date;
  sourceVideoId: string | null;
  venueKey: string | null;
  cameraKey: string;
  homography: Matrix3 | null;
};

export type MatchBenchmark = {
  match: {
    id: string;
    home: string;
    away: string;
    homeTeamName: string;
    awayTeamName: string;
    playedAt: Date;
    competition: string | null;
    venue: string | null;
    status: LabMatchRow["status"];
  };
  video: LabVideo | null;
  cv: LabJob | null;
  clips: LabJob | null;
  /** The cv job recall is measured on: the latest succeeded one. */
  measured: LabJob | null;
  thresholds: AutoAcceptThresholds;
  recall: MatchRecall | null;
  tags: Awaited<ReturnType<typeof tagsOf>>;
  tagCounts: Record<BenchmarkTagSource, number>;
  /** Clip per event id, for the unmatched list. */
  clipsByEvent: Map<string, { id: string; deletedAt: Date | null }>;
  /** Event team side per event id. */
  sideByEvent: Map<string, "home" | "away" | "unknown" | null>;
  /** Event status per event id. */
  statusByEvent: Map<string, string>;
  detections: Detection[];
  calibration: LabCalibration | null;
  readySec: number | null;
  /** The still of the latest cv attempt, when one was stored. */
  stillKey: string | null;
};

/** The calibration still of the job's latest attempt, if the worker stored it. */
export async function stillKeyFor(
  organisationId: string,
  matchId: string,
  job: { id: string; attempts: number } | null,
): Promise<string | null> {
  if (!job || job.attempts < 1) return null;
  for (let attempt = job.attempts; attempt >= 1; attempt--) {
    const key = cvStillKey(organisationId, matchId, job.id, attempt);
    try {
      await s3Internal().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
      return key;
    } catch {
      // not there: try the attempt before
    }
  }
  return null;
}

export async function matchBenchmark(
  ctx: AuthContext,
  matchId: string,
): Promise<MatchBenchmark | null> {
  const m = await ctx.db.match.findFirst({
    where: { id: matchId },
    select: {
      id: true,
      status: true,
      playedAt: true,
      competition: true,
      venue: true,
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  });
  if (!m) return null;
  const videos = await ctx.db.video.findMany({
    where: { matchId },
    orderBy: { createdAt: "desc" },
    select: { ...VIDEO_SELECT, pitchCalibrationId: true },
  });
  const video = videos[0] ?? null;
  const allJobs = await ctx.db.processingJob.findMany({
    where: { matchId },
    orderBy: { queuedAt: "desc" },
    select: JOB_SELECT,
  });
  const ofVideo = video ? allJobs.filter((j) => j.videoId === video.id) : [];
  const cv = ofVideo.find((j) => j.type === "cv") ?? null;
  const clips = ofVideo.find((j) => j.type === "clips") ?? null;
  const measured = allJobs.find((j) => j.type === "cv" && j.status === "succeeded") ?? null;
  const thresholds = thresholdsOf(measured ?? cv);
  const tags = await tagsOf(ctx, matchId);
  const tagCounts = { hand: 0, synthetic: 0, soccernet: 0 } as Record<BenchmarkTagSource, number>;
  for (const t of tags) tagCounts[t.source] += 1;

  let recall: MatchRecall | null = null;
  let detections: Detection[] = [];
  const clipsByEvent = new Map<string, { id: string; deletedAt: Date | null }>();
  const sideByEvent = new Map<string, "home" | "away" | "unknown" | null>();
  const statusByEvent = new Map<string, string>();
  if (measured) {
    const rows = await ctx.db.event.findMany({
      where: { jobId: measured.id },
      select: {
        id: true,
        type: true,
        timestampMs: true,
        onTarget: true,
        confidence: true,
        teamSide: true,
        status: true,
        clip: { select: { id: true, deletedAt: true } },
      },
    });
    detections = rows.map(({ id, type, timestampMs, onTarget, confidence }) => ({
      id,
      type,
      timestampMs,
      onTarget,
      confidence,
    }));
    for (const r of rows) {
      if (r.clip) clipsByEvent.set(r.id, r.clip);
      sideByEvent.set(r.id, r.teamSide);
      statusByEvent.set(r.id, r.status);
    }
    if (tags.length) recall = matchRecall(detections, tags, thresholds);
  }

  const calId = video?.pitchCalibrationId ?? null;
  const cal = calId
    ? await ctx.db.pitchCalibration.findFirst({
        where: { id: calId },
        select: {
          id: true,
          source: true,
          confidence: true,
          reprojectionErrorM: true,
          pointCount: true,
          createdAt: true,
          sourceVideoId: true,
          venueKey: true,
          cameraKey: true,
          homography: true,
        },
      })
    : null;

  return {
    match: {
      id: m.id,
      home: m.homeTeam.name,
      away: m.awayTeam.name,
      homeTeamName: m.homeTeam.name,
      awayTeamName: m.awayTeam.name,
      playedAt: m.playedAt,
      competition: m.competition,
      venue: m.venue,
      status: m.status,
    },
    video: video ? { ...video, validation: video.validation as FootageValidation | null } : null,
    cv: cv ? asJob(cv) : null,
    clips: clips ? asJob(clips) : null,
    measured: measured ? asJob(measured) : null,
    thresholds,
    recall,
    tags,
    tagCounts,
    clipsByEvent,
    sideByEvent,
    statusByEvent,
    detections,
    calibration: cal
      ? { ...cal, homography: isMatrix3(cal.homography) ? cal.homography : null }
      : null,
    readySec: video ? reviewReadyDuration(video.uploadedAt, ofVideo) : null,
    stillKey: await stillKeyFor(ctx.organisationId, matchId, cv),
  };
}

export type ModelBenchmark = {
  modelVersion: string;
  matches: number;
  lastRun: Date;
  rows: (RecallRow & { matches: number })[];
};

/**
 * Recall per model version over the Lab's tagged matches (Surface 5): per
 * version, the succeeded cv jobs of matches with tags, rows pooled across
 * matches. Newest version run first.
 */
export async function benchmarkByModel(ctx: AuthContext): Promise<ModelBenchmark[]> {
  const jobs = await ctx.db.processingJob.findMany({
    where: { type: "cv", status: "succeeded", modelVersion: { not: null } },
    select: { id: true, matchId: true, modelVersion: true, finishedAt: true, metadata: true },
  });
  const byVersion = new Map<string, ModelBenchmark>();
  for (const job of jobs) {
    const tags = await tagsOf(ctx, job.matchId);
    if (!tags.length) continue;
    const r = matchRecall(await detectionsOf(ctx, job.id), tags, thresholdsOf(job));
    const key = job.modelVersion!;
    const entry = byVersion.get(key) ?? {
      modelVersion: key,
      matches: 0,
      lastRun: job.finishedAt ?? new Date(0),
      rows: RECALL_ROWS.map((type) => ({
        type,
        tagged: 0,
        detected: 0,
        matched: 0,
        autoMatched: 0,
        matches: 0,
      })),
    };
    entry.matches += 1;
    if (job.finishedAt && job.finishedAt > entry.lastRun) entry.lastRun = job.finishedAt;
    for (const row of r.rows) {
      const into = entry.rows.find((x) => x.type === row.type)!;
      into.tagged += row.tagged;
      into.detected += row.detected;
      into.matched += row.matched;
      into.autoMatched += row.autoMatched;
      if (row.tagged > 0) into.matches += 1;
    }
    byVersion.set(key, entry);
  }
  return [...byVersion.values()].sort((a, b) => b.lastRun.getTime() - a.lastRun.getTime());
}

export function rowOf(rows: readonly RecallRow[] | null, type: RecallRowType): RecallRow | null {
  return rows?.find((r) => r.type === type) ?? null;
}
