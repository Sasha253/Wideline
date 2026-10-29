import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db/raw";
import { TenantScopeError } from "@/server/db/scoped";
import { fixtures } from "./helpers/fixtures";
import { match, setupClub } from "./helpers/matches";
import { acceptedVideo } from "./helpers/transcode";

// NFR16 for the C07 table ProcessingJob: organisation B's scoped client sees
// none of A's jobs and cannot change them; the composite foreign keys refuse
// a job pointing at another organisation's match or video; deleting a match
// cascades its jobs. Also the database rules: one transcode job per video,
// attempts within maxAttempts, and a failed job carries an error.

const f = fixtures();
let a: Awaited<ReturnType<typeof setupClub>>;
let b: Awaited<ReturnType<typeof setupClub>>;
let matchA: string;
let matchB: string;
let videoA: string;
let jobA: string;

/** The Prisma error code, or the database constraint name in its message. */
async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const e = err as { code?: string; message?: string; meta?: unknown };
    return `${e.code ?? ""} ${JSON.stringify(e.meta ?? {})} ${e.message ?? ""}`;
  }
  throw new Error("expected the write to be refused");
}

beforeAll(async () => {
  a = await setupClub(f, "Jobs A FC");
  b = await setupClub(f, "Jobs B FC");
  matchA = (await match(a.ctx, a.own.id, a.opposition.id)).id;
  matchB = (await match(b.ctx, b.own.id, b.opposition.id)).id;
  const { video, job } = await acceptedVideo(a.org.id, matchA);
  videoA = video.id;
  jobA = job.id;
});

afterAll(async () => {
  await f.cleanup();
});

describe("tenant isolation for processing jobs", () => {
  it("hides A's jobs from B's scoped client, and shows them to A", async () => {
    expect(await b.ctx.db.processingJob.findFirst({ where: { id: jobA } })).toBeNull();
    expect(await b.ctx.db.processingJob.count()).toBe(0);
    expect(await b.ctx.db.processingJob.findMany({ where: { matchId: matchA } })).toEqual([]);
    expect(await a.ctx.db.processingJob.findFirst({ where: { id: jobA } })).not.toBeNull();
  });

  it("lets B change and delete none of A's jobs", async () => {
    expect(
      (
        await b.ctx.db.processingJob.updateMany({
          where: { id: jobA },
          data: { status: "failed", errorMessage: "x" },
        })
      ).count,
    ).toBe(0);
    expect((await b.ctx.db.processingJob.deleteMany({ where: { id: jobA } })).count).toBe(0);
    await expect(
      b.ctx.db.processingJob.update({ where: { id: jobA }, data: { attempts: 1 } }),
    ).rejects.toThrow();
    await expect(
      b.ctx.db.processingJob.create({
        data: {
          organisationId: a.org.id,
          matchId: matchA,
          type: "cv",
          bossJobId: randomUUID(),
        },
      }),
    ).rejects.toThrow(TenantScopeError);
    expect((await rawDb.processingJob.findUniqueOrThrow({ where: { id: jobA } })).status).toBe(
      "queued",
    );
  });

  it("refuses a job pointing at another organisation's match or video", async () => {
    expect(
      await refusal(
        rawDb.processingJob.create({
          data: { organisationId: b.org.id, matchId: matchA, type: "cv", bossJobId: randomUUID() },
        }),
      ),
    ).toMatch(/P2003|ProcessingJob_organisationId_matchId_fkey/);
    expect(
      await refusal(
        rawDb.processingJob.create({
          data: {
            organisationId: b.org.id,
            matchId: matchB,
            videoId: videoA,
            type: "cv",
            bossJobId: randomUUID(),
          },
        }),
      ),
    ).toMatch(/P2003|ProcessingJob_organisationId_videoId_fkey/);
    // B's scoped client cannot reach A's match either.
    expect(
      await refusal(
        b.ctx.db.processingJob.create({
          data: {
            organisationId: b.org.id,
            matchId: matchA,
            type: "cv",
            bossJobId: randomUUID(),
          },
        }),
      ),
    ).toMatch(/P2003|ProcessingJob_organisationId_matchId_fkey/);
  });

  it("holds one job per video and type, attempts within range, and an error when failed", async () => {
    expect(
      await refusal(
        rawDb.processingJob.create({
          data: {
            organisationId: a.org.id,
            matchId: matchA,
            videoId: videoA,
            type: "transcode",
            bossJobId: randomUUID(),
          },
        }),
      ),
    ).toMatch(/P2002|ProcessingJob_video_type_key/);
    // C08: one job per video and type, so a cv job sits next to the transcode,
    // and a second cv job is refused.
    const cv = {
      organisationId: a.org.id,
      matchId: matchA,
      videoId: videoA,
      type: "cv" as const,
    };
    await rawDb.processingJob.create({ data: { ...cv, bossJobId: randomUUID() } });
    expect(
      await refusal(rawDb.processingJob.create({ data: { ...cv, bossJobId: randomUUID() } })),
    ).toMatch(/P2002|ProcessingJob_video_type_key/);
    expect(
      await refusal(rawDb.processingJob.update({ where: { id: jobA }, data: { attempts: 4 } })),
    ).toMatch(/ProcessingJob_attempts_range/);
    expect(
      await refusal(
        rawDb.processingJob.update({ where: { id: jobA }, data: { status: "failed" } }),
      ),
    ).toMatch(/ProcessingJob_failed_has_error/);
    expect(
      await refusal(
        rawDb.processingJob.update({
          where: { id: jobA },
          data: {
            startedAt: new Date("2026-10-26T12:00:00Z"),
            finishedAt: new Date("2026-10-26T11:00:00Z"),
          },
        }),
      ),
    ).toMatch(/ProcessingJob_times_ordered/);
  });

  it("deletes a match's jobs with the match", async () => {
    expect(await rawDb.processingJob.count({ where: { matchId: matchA } })).toBe(2);
    await rawDb.match.delete({ where: { id: matchA } });
    expect(await rawDb.processingJob.count({ where: { matchId: matchA } })).toBe(0);
  });
});
