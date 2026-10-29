import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserContext } from "@/server/auth/session";

// C09 (Surface 3, NFR08, NFR17): GET /lab/clips/[clipId] is for platform
// admins only (401 signed out, 403 for a club coach). It answers 404 for
// another organisation's clip, a deleted clip, and a clip whose event is
// attributed to a player who may not be attributed; a team-level or
// attributable player's clip is a 302 to a presigned URL, never cached.

let current: UserContext | null = null;

vi.mock("@/server/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/session")>();
  // The real role check, on the fixture context instead of the request's session.
  const requireRole = async (roles: readonly string[]) => {
    if (!current) throw new actual.AuthzError(401, "Not signed in");
    if (!current.organisationId) throw new actual.AuthzError(403, actual.NO_ORGANISATION);
    if (!current.roles.some((r) => roles.includes(r))) {
      throw new actual.AuthzError(403, `Requires one of: ${roles.join(", ")}`);
    }
    return current;
  };
  // withRole as in session.ts, over the role check above.
  const withRole =
    <P>(
      roles: readonly string[],
      handler: (req: Request, ctx: never, params: P) => Promise<Response>,
    ) =>
    async (req: Request, routeCtx: { params: Promise<P> }) => {
      let ctx;
      try {
        ctx = await requireRole(roles);
      } catch (err) {
        if (err instanceof actual.AuthzError) {
          return Response.json({ error: err.message }, { status: err.status });
        }
        throw err;
      }
      return handler(req, ctx as never, await routeCtx.params);
    };
  return { ...actual, requireRole, withRole };
});
vi.mock("@/server/consent/jobs", () => ({ enqueueConsentWithdrawn: vi.fn(async () => {}) }));
vi.mock("@/server/mail-transport", () => ({ deliverMail: vi.fn(async () => {}) }));

const { contextForSession } = await import("@/server/auth/session");
const { ingestCvResult } = await import("@/server/cv/ingest");
const { rawDb } = await import("@/server/db/raw");
const { handleClips } = await import("@/worker/clips");
const route = await import("@/app/(app)/lab/clips/[clipId]/route");
const { fakeCutter, ingestInput } = await import("./helpers/clips");
const { event, playerWithConsent, result, runningCvJob } = await import("./helpers/cv");
const { fixtures } = await import("./helpers/fixtures");
const { match, setupClub } = await import("./helpers/matches");
const { acceptedVideo } = await import("./helpers/transcode");

const f = fixtures();
let a: Awaited<ReturnType<typeof setupClub>>;
let admin: { id: string; name: string; email: string };
/** A's clips by event time: team level, attributable, not attributable, deleted. */
let clips: Record<"team" | "adult" | "minor" | "deleted", string>;
let otherClip = "";

async function as(user: { id: string; name: string; email: string } | null, orgId?: string) {
  current = user
    ? await contextForSession({ sessionId: "s", user, activeOrganisationId: orgId ?? null })
    : null;
}

const get = (clipId: string) =>
  route.GET(new Request(`http://test/lab/clips/${clipId}`), {
    params: Promise.resolve({ clipId }),
  });

/** A match with a CV run and its clips cut; the clip ids in event-time order. */
async function cutClips(club: Awaited<ReturnType<typeof setupClub>>, times: number[]) {
  const { id: matchId } = await match(club.ctx, club.own.id, club.opposition.id);
  const { video } = await acceptedVideo(club.org.id, matchId, { durationSec: 120 });
  const job = await runningCvJob(club.org.id, matchId, video.id);
  const out = await ingestCvResult(
    ingestInput(
      job,
      video.id,
      result(
        job,
        [],
        times.map((t) => event("shot", null, 0.95, t)),
      ),
    ),
  );
  await handleClips(
    { organisationId: club.org.id, videoId: video.id, processingJobId: out.clipsJob!.id },
    { retryCount: 0, retryLimit: 2 },
    { cutter: fakeCutter().cutter },
  );
  const rows = await rawDb.clip.findMany({
    where: { matchId },
    orderBy: { startMs: "asc" },
    select: { id: true, eventId: true },
  });
  expect(rows).toHaveLength(times.length);
  return rows.map((r) => ({ ...r, matchId, jobId: job.id }));
}

/** Links a clip's event to a player through a track of their own (Event_player_needs_track). */
async function attribute(
  clip: { eventId: string; matchId: string; jobId: string },
  playerId: string,
  trackIndex: number,
) {
  const track = await rawDb.track.create({
    data: {
      organisationId: a.org.id,
      matchId: clip.matchId,
      jobId: clip.jobId,
      trackIndex: 1000 + trackIndex,
      teamSide: "home",
      playerId,
      linkedBy: "cv",
    },
  });
  await rawDb.event.update({ where: { id: clip.eventId }, data: { trackId: track.id, playerId } });
}

beforeAll(async () => {
  a = await setupClub(f, "Lab Clips A");
  const b = await setupClub(f, "Lab Clips B");
  admin = await f.user("Lab Clips Admin");
  await f.member(a.org.id, admin.id, "platform_admin");

  const [team, adult, minor, deleted] = await cutClips(a, [20_000, 40_000, 60_000, 80_000]);
  const adultPlayer = await playerWithConsent(a.ctx, a.own.id, "club_only", 25);
  const minorPlayer = await playerWithConsent(a.ctx, a.own.id, "none", 14);
  await attribute(adult!, adultPlayer.id, 1);
  await attribute(minor!, minorPlayer.id, 2);
  await rawDb.clip.update({ where: { id: deleted!.id }, data: { deletedAt: new Date() } });
  clips = { team: team!.id, adult: adult!.id, minor: minor!.id, deleted: deleted!.id };
  otherClip = (await cutClips(b, [30_000]))[0]!.id;
  // The Lab runs in the platform organisation: platform_admin means nothing elsewhere.
  await rawDb.organisation.update({ where: { id: a.org.id }, data: { type: "platform" } });
}, 90_000);

afterAll(async () => {
  await f.cleanup();
});

describe("GET /lab/clips/[clipId]", { timeout: 30_000 }, () => {
  it("answers 401 signed out and 403 to a club coach", async () => {
    await as(null);
    expect((await get(clips.team)).status).toBe(401);
    await as(a.coach, a.org.id);
    expect((await get(clips.team)).status).toBe(403);
  });

  it("redirects a platform admin to a presigned URL, never cached", async () => {
    await as(admin, a.org.id);
    for (const id of [clips.team, clips.adult]) {
      const res = await get(id);
      expect(res.status).toBe(302);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("location")).toMatch(/X-Amz-Expires=60\b/);
    }
  });

  it("answers 404 for another organisation's clip, a deleted clip and a non-attributable player's clip", async () => {
    await as(admin, a.org.id);
    expect((await get(otherClip)).status).toBe(404);
    expect((await get(clips.deleted)).status).toBe(404);
    expect((await get(clips.minor)).status).toBe(404);
    expect((await get("no-such-clip")).status).toBe(404);
  });
});
