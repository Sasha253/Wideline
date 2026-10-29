import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rawDb } from "@/server/db/raw";
import { alertPlatformAdmins } from "@/server/processing/alerts";
import { alertsFor, cvJob, platformAdmin } from "./helpers/cv";
import { fixtures } from "./helpers/fixtures";
import { match, setupClub } from "./helpers/matches";
import { acceptedVideo } from "./helpers/transcode";

// C08 (NFR30): the alert claim (ProcessingJob.alertedAt) is given back when
// the email cannot be sent, so a later final-failure path or the watchdog
// tries again. Once it is sent, it is never sent again.

const deliverMail = vi.hoisted(() =>
  vi.fn<(to: string, subject: string, text: string) => Promise<void>>(async () => {}),
);
vi.mock("@/server/mail-transport", () => ({ deliverMail }));

const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;

beforeAll(async () => {
  club = await setupClub(f, "Alerts FC");
  await platformAdmin(f);
});

afterAll(async () => {
  await f.cleanup();
});

describe("alertPlatformAdmins", () => {
  it("gives the claim back when the email fails, then sends once", async () => {
    const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
    const { video } = await acceptedVideo(club.org.id, matchId);
    const job = await cvJob(club.org.id, matchId, video.id);

    deliverMail.mockRejectedValueOnce(new Error("smtp down"));
    expect(await alertPlatformAdmins(job, "worker lost")).toBe(false);
    const after = await rawDb.processingJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.alertedAt).toBeNull();

    deliverMail.mockClear();
    expect(await alertPlatformAdmins(job, "worker lost")).toBe(true);
    const sent = alertsFor(deliverMail.mock.calls, job.id);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(
      (await rawDb.processingJob.findUniqueOrThrow({ where: { id: job.id } })).alertedAt,
    ).not.toBeNull();

    expect(await alertPlatformAdmins(job, "worker lost")).toBe(false);
    expect(alertsFor(deliverMail.mock.calls, job.id)).toHaveLength(sent.length);
  });
});
