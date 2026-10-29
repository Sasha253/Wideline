import { randomUUID } from "node:crypto";
import { todayIso } from "@/lib/squad-fields";
import type { AuthContext } from "@/server/auth/session";
import { recordConsent, withdrawConsent } from "@/server/consent/records";
import type { CvEvent, CvResult, CvTrack } from "@/server/cv/contract";
import type {
  GpuInstanceState,
  GpuListedInstance,
  GpuProvider,
  GpuStartSpec,
} from "@/server/cv/providers/types";
import { rawDb } from "@/server/db/raw";
import { createCvJob, markRunning, type JobRef } from "@/server/processing/jobs";
import { guardianGrant, namedPlayer } from "./consent";
import type { fixtures } from "./fixtures";

// C08 fixtures: the cv job of an accepted video, players in each consent
// state on a lineup, contract results, and a fake GPU provider that records
// what the dispatcher asks of it.

/** The video's cv job, as the probe creates it. */
export async function cvJob(organisationId: string, matchId: string, videoId: string) {
  const { job } = await rawDb.$transaction((tx) =>
    createCvJob(tx, { organisationId, matchId, videoId }),
  );
  return job;
}

/** The cv job moved to running attempt 1, as the handler leaves it before ingest. */
export async function runningCvJob(
  organisationId: string,
  matchId: string,
  videoId: string,
): Promise<JobRef> {
  const job = await cvJob(organisationId, matchId, videoId);
  const running = await markRunning(job, 1);
  if (!running) throw new Error("cv job did not start");
  return running;
}

/** Marks the video's transcode job succeeded, as a finished transcode leaves it. */
export async function transcodeDone(jobId: string) {
  await rawDb.processingJob.update({
    where: { id: jobId },
    data: { status: "succeeded", attempts: 1, startedAt: new Date(), finishedAt: new Date() },
  });
}

export type ConsentKind = "none" | "club_only" | "scout_visible" | "withdrawn";

/** A named player of this age in a consent state. */
export async function playerWithConsent(
  ctx: AuthContext,
  teamId: string,
  kind: ConsentKind,
  age = 14,
) {
  const p = await namedPlayer(ctx, teamId, { age });
  const adult = age >= 18;
  const grant = (scoutVisible: "yes" | "no") =>
    adult
      ? {
          relationship: "self",
          method: "in_person",
          grantedAt: todayIso(),
          clubStats: "yes",
          scoutVisible,
          seenWording: "on",
        }
      : guardianGrant({ scoutVisible });
  if (kind === "club_only") await recordConsent(ctx, p.id, grant("no"));
  if (kind === "scout_visible" || kind === "withdrawn")
    await recordConsent(ctx, p.id, grant("yes"));
  if (kind === "withdrawn") {
    await withdrawConsent(ctx, p.id, {
      requestedBy: adult ? p.name : "Thandi Mokoena",
      method: "in_person",
    });
  }
  return p;
}

/** An unnamed opposition placeholder (no consent, ever). */
export async function placeholder(organisationId: string, teamId: string) {
  return rawDb.player.create({ data: { organisationId, teamId, isPlaceholder: true } });
}

/** Puts a player on the match's lineup in this shirt. */
export async function onLineup(
  organisationId: string,
  matchId: string,
  teamId: string,
  playerId: string,
  shirtNumber: number,
) {
  return rawDb.lineup.create({
    data: { organisationId, matchId, teamId, playerId, shirtNumber, startedAt: 0 },
  });
}

export function track(
  trackIndex: number,
  teamSide: CvTrack["teamSide"],
  shirtNumber: number | null,
  shirtConfidence: number | null,
  points = 3,
): CvTrack {
  return {
    trackIndex,
    teamSide,
    shirtNumber,
    shirtConfidence,
    points: Array.from({ length: points }, (_, i) => ({
      tMs: 1000 + i * 200,
      x: 10 + i,
      y: 20 + i,
    })),
  };
}

export function event(
  type: CvEvent["type"],
  trackIndex: number | null,
  confidence: number,
  tMs = 60_000,
): CvEvent {
  return {
    type,
    trackIndex,
    tMs,
    x: 80,
    y: 34,
    confidence,
    ...(type === "shot" && { onTarget: true }),
    clipStartMs: tMs - 5000,
    clipEndMs: tMs + 3000,
  };
}

export function result(
  job: { id: string; matchId: string },
  tracks: CvTrack[] = [],
  events: CvEvent[] = [],
): CvResult {
  return {
    schemaVersion: "1.0",
    jobId: job.id,
    matchId: job.matchId,
    modelVersions: { detector: "stub-0", tracker: "stub-0", events: "stub-0" },
    video: { durationSec: 20, fps: 25, sampledFps: 5 },
    calibration: {
      confidence: 0.9,
      homography: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    },
    tracks,
    events,
    warnings: [],
  };
}

/** A fake GPU provider: starts "containers" in memory, with a scripted state. */
export class FakeGpuProvider implements GpuProvider {
  readonly name = "fake";
  readonly billing = {
    centsPerHour: 3600,
    currency: "USD",
    minimumSeconds: 0,
    incrementSeconds: 1,
  };
  started: GpuStartSpec[] = [];
  destroyed: string[] = [];
  states = new Map<string, GpuInstanceState>();
  /** Runs when an instance starts: plays the worker (callbacks, result upload). */
  onStart: (spec: GpuStartSpec, providerInstanceId: string) => Promise<void> = async () => {};

  async start(spec: GpuStartSpec) {
    const id = `fake-${randomUUID().slice(0, 8)}`;
    this.started.push(spec);
    this.states.set(id, "running");
    await this.onStart(spec, id);
    return { providerInstanceId: id };
  }
  async status(id: string) {
    return this.states.get(id) ?? "gone";
  }
  async destroy(id: string) {
    this.destroyed.push(id);
    this.states.delete(id);
  }
  async list(): Promise<GpuListedInstance[]> {
    return [];
  }
}

/**
 * A platform admin, so an NFR30 alert has someone to go to. CI runs the tests
 * before the seed, so without this there would be no admin and no email.
 */
export async function platformAdmin(f: ReturnType<typeof fixtures>) {
  const platform = await f.org("Platform", { type: "platform" });
  const admin = await f.user("Alert Admin");
  await f.member(platform.id, admin.id, "platform_admin");
  return admin;
}

/** Every accepted platform admin's email, as alertPlatformAdmins() reads them. */
export async function platformAdminEmails(): Promise<string[]> {
  const rows = await rawDb.membership.findMany({
    where: {
      role: "platform_admin",
      acceptedAt: { not: null },
      organisation: { type: "platform" },
    },
    select: { user: { select: { email: true } } },
  });
  return [...new Set(rows.map((r) => r.user.email))].sort();
}

/** The alert emails a mocked deliverMail(to, subject, text) sent for this job. */
export function alertsFor(calls: unknown[][], jobId: string) {
  return calls
    .filter((c) => String(c[1]).includes(jobId))
    .map((c) => ({ to: String(c[0]), subject: String(c[1]), text: String(c[2]) }));
}
