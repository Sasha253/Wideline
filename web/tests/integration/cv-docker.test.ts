import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cvConfig } from "@/server/cv/config";
import { dockerProvider, socketTransport } from "@/server/cv/providers/docker";
import { rawDb } from "@/server/db/raw";
import { handleCvJob } from "@/worker/cv";
import { deletePrefix } from "@/worker/retention";
import { fixtures } from "./helpers/fixtures";
import { cvJob, transcodeDone } from "./helpers/cv";
import { match, setupClub, storageAvailable } from "./helpers/matches";
import { acceptedVideo } from "./helpers/transcode";

// C08 end to end with the real docker provider: the dispatcher starts the
// wideline-cv-worker image on the compose network, the worker runs the stub
// pipeline, PUTs its result to RustFS through the signed URL, calls back
// through the web app's callback route, and the dispatcher destroys the
// container and ingests. Runs only where the Docker socket and the image are
// present (the cv-dispatcher container after `make up`); skipped loudly
// elsewhere, including the web container and CI.

vi.mock("@/server/mail-transport", () => ({ deliverMail: vi.fn(async () => {}) }));

async function imagePresent(): Promise<boolean> {
  const socket = cvConfig().DOCKER_SOCKET;
  if (!existsSync(socket)) return false;
  try {
    const res = await socketTransport(socket)(
      "GET",
      `/images/${encodeURIComponent(cvConfig().CV_WORKER_IMAGE)}/json`,
    );
    return res.status === 200;
  } catch {
    return false;
  }
}

const ready = (await imagePresent()) && (await storageAvailable());
if (!ready) {
  console.warn("cv-docker: SKIPPED, no Docker socket, no wideline-cv-worker image or no RustFS");
}

const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;

beforeAll(async () => {
  if (ready) club = await setupClub(f, "Docker CV FC");
});

afterAll(async () => {
  if (ready && club) await deletePrefix(`orgs/${club.org.id}/`);
  await f.cleanup();
});

describe.skipIf(!ready)("cv with the docker provider", { timeout: 180_000 }, () => {
  it("runs the stub worker in a container and ingests its result", async () => {
    const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
    const { video, job: transcode } = await acceptedVideo(club.org.id, matchId);
    await transcodeDone(transcode.id);
    const job = await cvJob(club.org.id, matchId, video.id);
    const provider = dockerProvider();

    const outcome = await handleCvJob(
      { organisationId: club.org.id, videoId: video.id, processingJobId: job.id },
      { retryCount: 0, retryLimit: 2 },
      { provider, pollMs: 1000 },
    );
    expect(outcome).toBe("succeeded");

    const row = await rawDb.processingJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ status: "succeeded", gpuProvider: "docker" });
    expect((row.metadata as { warnings: string[] }).warnings).toEqual([
      "pipeline stub: no detections",
    ]);
    const [instance] = await rawDb.gpuInstance.findMany({ where: { processingJobId: job.id } });
    expect(instance).toMatchObject({ status: "destroyed", destroyReason: "job_done" });
    expect(await provider.status(instance!.providerInstanceId!)).toBe("gone");
    expect((await rawDb.match.findUniqueOrThrow({ where: { id: matchId } })).status).toBe(
      "awaiting_review",
    );
  });
});
