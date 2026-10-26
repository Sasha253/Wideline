import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserContext } from "@/server/auth/session";

// C07 acceptance (MATCH06, NFR17): playback is private. The playlist and
// segment routes check the session and role on every request: 401 signed
// out, 403 for a scout (no review claim until C10/C11), 404 for another
// organisation's match or before the transcode. Playlists point only at app
// routes; a segment answers 302 to a short-lived presigned URL, and a URL
// past its expiry gets 403 from the store. Against the compose stack's
// RustFS and the HLS fixture (`make fixtures`); skipped without them.

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

const { contextForSession } = await import("@/server/auth/session");
const { signedSegmentUrl } = await import("@/server/matches/playback");
const { deletePrefix } = await import("@/worker/retention");
const master = await import("@/app/api/matches/[matchId]/hls/master.m3u8/route");
const file = await import("@/app/api/matches/[matchId]/hls/[rendition]/[file]/route");
const { fixtures } = await import("./helpers/fixtures");
const { match, setupClub, storageAvailable } = await import("./helpers/matches");
const { acceptedVideo, hlsFixtureAvailable, seedHls } = await import("./helpers/transcode");

const hasStorage = await storageAvailable();
const hasFixture = hlsFixtureAvailable();
const ready = hasStorage && hasFixture;
if (!ready) {
  console.warn(
    `playback: SKIPPED, ${hasStorage ? "" : "no object storage answers (RustFS) "}${hasFixture ? "" : "no HLS fixture (make fixtures)"}`,
  );
}

const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;
let other: Awaited<ReturnType<typeof setupClub>>;
let matchId = "";
let keys: Awaited<ReturnType<typeof seedHls>>;
let pendingMatchId = "";

async function as(user: { id: string; name: string; email: string } | null, orgId?: string) {
  current = user
    ? await contextForSession({ sessionId: "s", user, activeOrganisationId: orgId ?? null })
    : null;
}

const getMaster = (id: string) =>
  master.GET(new Request(`http://test/api/matches/${id}/hls/master.m3u8`), {
    params: Promise.resolve({ matchId: id }),
  });
const getFile = (id: string, rendition: string, name: string) =>
  file.GET(new Request(`http://test/api/matches/${id}/hls/${rendition}/${name}`), {
    params: Promise.resolve({ matchId: id, rendition, file: name }),
  });

beforeAll(async () => {
  if (!ready) return;
  club = await setupClub(f, "Playback FC");
  other = await setupClub(f, "Other Playback FC");
  ({ id: matchId } = await match(club.ctx, club.own.id, club.opposition.id));
  const { video } = await acceptedVideo(club.org.id, matchId);
  keys = await seedHls(club.org.id, matchId, video.id);
  ({ id: pendingMatchId } = await match(club.ctx, club.own.id, club.opposition.id));
  await acceptedVideo(club.org.id, pendingMatchId);
});

afterAll(async () => {
  if (ready && club) await deletePrefix(`orgs/${club.org.id}/`);
  await f.cleanup();
});

describe.skipIf(!ready)("playback routes", { timeout: 30_000 }, () => {
  it("answers 401 to a signed-out request", async () => {
    await as(null);
    expect((await getMaster(matchId)).status).toBe(401);
    expect((await getFile(matchId, "720p", "index.m3u8")).status).toBe(401);
    expect((await getFile(matchId, "720p", "seg_00000.m4s")).status).toBe(401);
  });

  it("serves the master playlist with every variant on an app route, never cached", async () => {
    await as(club.coach, club.org.id);
    const res = await getMaster(matchId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.apple.mpegurl");
    expect(res.headers.get("cache-control")).toBe("no-store, private");
    const text = await res.text();
    for (const r of ["1080p", "720p", "480p"]) {
      expect(text).toContain(`/api/matches/${matchId}/hls/${r}/index.m3u8`);
    }
    expect(text).not.toMatch(/orgs\/|X-Amz|http/);
  });

  it("serves media playlists on app routes and redirects segments to a short-lived URL", async () => {
    await as(club.coach, club.org.id);
    const res = await getFile(matchId, "480p", "index.m3u8");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store, private");
    const text = await res.text();
    expect(text).toContain(`#EXT-X-MAP:URI="/api/matches/${matchId}/hls/480p/init.mp4"`);
    expect(text).toContain(`/api/matches/${matchId}/hls/480p/seg_00000.m4s`);
    expect(text).not.toMatch(/orgs\/|X-Amz/);

    const seg = await getFile(matchId, "480p", "seg_00000.m4s");
    expect(seg.status).toBe(302);
    expect(seg.headers.get("cache-control")).toBe("no-store, private");
    const location = new URL(seg.headers.get("location")!);
    expect(location.origin).toBe(new URL(process.env.S3_PUBLIC_ENDPOINT!).origin);
    expect(location.pathname).toContain(`${keys.prefix}480p/seg_00000.m4s`);
    expect(location.searchParams.get("X-Amz-Expires")).toBe("60");
    const body = await fetch(location);
    expect(body.status).toBe(200);
    expect(body.headers.get("content-type")).toBe("video/iso.segment");

    expect((await getFile(matchId, "1080p", "init.mp4")).status).toBe(302);
  });

  it("lets owners, admins and coaches play, and refuses a scout", async () => {
    const admin = await f.user("Playback Admin");
    await f.member(club.org.id, admin.id, "admin");
    for (const [u] of [[club.owner], [club.coach], [admin]] as const) {
      await as(u, club.org.id);
      expect((await getMaster(matchId)).status).toBe(200);
    }
    const scout = await f.user("Playback Scout");
    await f.member(club.org.id, scout.id, "scout");
    await as(scout, club.org.id);
    expect((await getMaster(matchId)).status).toBe(403);
    expect((await getFile(matchId, "720p", "seg_00000.m4s")).status).toBe(403);
  });

  it("answers 404 for another organisation's match, an unknown file and before the transcode", async () => {
    await as(other.owner, other.org.id);
    expect((await getMaster(matchId)).status).toBe(404);
    expect((await getFile(matchId, "720p", "index.m3u8")).status).toBe(404);
    expect((await getFile(matchId, "720p", "seg_00000.m4s")).status).toBe(404);

    await as(club.coach, club.org.id);
    for (const [r, name] of [
      ["720p", "../raw/x.mp4"],
      ["..", "index.m3u8"],
      ["2160p", "index.m3u8"],
      ["720p", "master.m3u8"],
      ["720p", "seg_1.m4s"],
    ]) {
      const res = await getFile(matchId, r!, name!);
      expect(res.status, `${r}/${name}`).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store, private");
    }
    expect((await getMaster(pendingMatchId)).status).toBe(404);
    expect((await getMaster("no-such-match")).status).toBe(404);
  });

  it("signs URLs that expire: a 1 s URL works at first, then gets 403", async () => {
    const url = await signedSegmentUrl(keys.file("480p", "seg_00000.m4s"), "seg_00000.m4s", 1);
    expect((await fetch(url)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 2500));
    expect((await fetch(url)).status).toBe(403);
  });
});
