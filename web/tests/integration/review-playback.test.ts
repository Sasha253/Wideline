import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserContext } from "@/server/auth/session";

// C10 (NFR16, NFR17): the scout holding a live review claim plays the claimed
// match through /api/review/claims/{claimId}/hls/..., checked against the
// claim on every request. Playlists point only at the claim's routes; segments
// answer 302 to a short-lived presigned URL. 404 after a release, after the
// claim runs out, and for another scout. C11 (REVIEW11): after "Mark as
// reviewed" the master, the media playlist, a segment and the claim's clip
// route all answer 404; the clip route also answers 404 for another claim's
// clip, a deleted clip and a clip of a player who cannot be attributed.
// Against the compose stack's RustFS and the HLS fixture (`make fixtures`);
// skipped without them.

let current: UserContext | null = null;

vi.mock("@/server/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/session")>();
  // The real role check, on the fixture context instead of the request's session.
  return {
    ...actual,
    requireRole: async (roles: readonly string[]) => {
      if (!current) throw new actual.AuthzError(401, "Not signed in");
      if (!current.organisationId) throw new actual.AuthzError(403, actual.NO_ORGANISATION);
      if (!current.roles.some((r) => roles.includes(r))) {
        throw new actual.AuthzError(403, `Requires one of: ${roles.join(", ")}`);
      }
      return current;
    },
  };
});

const { rawDb } = await import("@/server/db/raw");
const { claimMatch, releaseClaim } = await import("@/server/review/claims");
const { deletePrefix } = await import("@/worker/retention");
const master = await import("@/app/api/review/claims/[claimId]/hls/master.m3u8/route");
const file = await import("@/app/api/review/claims/[claimId]/hls/[rendition]/[file]/route");
const { fixtures } = await import("./helpers/fixtures");
const { storageAvailable } = await import("./helpers/matches");
const { hlsFixtureAvailable, seedHls } = await import("./helpers/transcode");
const { reviewer, reviewMatch } = await import("./helpers/review");
const clipRoute = await import("@/app/api/review/claims/[claimId]/clips/[clipId]/route");
const { submitReview } = await import("@/server/review/submit");
const { claimScope } = await import("@/server/review/scope");
const ws = await import("./helpers/workspace");

const hasStorage = await storageAvailable();
const hasFixture = hlsFixtureAvailable();
const ready = hasStorage && hasFixture;
if (!ready) {
  console.warn(
    `review-playback: SKIPPED, ${hasStorage ? "" : "no object storage answers (RustFS) "}${hasFixture ? "" : "no HLS fixture (make fixtures)"}`,
  );
}

const f = fixtures();
const orgs: string[] = [];

const getMaster = (claimId: string) =>
  master.GET(new Request(`http://test/api/review/claims/${claimId}/hls/master.m3u8`), {
    params: Promise.resolve({ claimId }),
  });
const getFile = (claimId: string, rendition: string, name: string) =>
  file.GET(new Request(`http://test/api/review/claims/${claimId}/hls/${rendition}/${name}`), {
    params: Promise.resolve({ claimId, rendition, file: name }),
  });

async function claimedWithHls(label: string) {
  const scout = await reviewer(f, label);
  const m = await reviewMatch(f, `Playback ${label}`);
  orgs.push(m.organisationId);
  await seedHls(m.organisationId, m.matchId, m.videoId);
  const { claimId } = await claimMatch(scout, m.matchId, { declaration: true });
  return { scout, m, claimId };
}

beforeAll(() => {
  current = null;
});

// Five organisations' HLS objects in RustFS: deleted together, and with room
// for a loaded full-suite run (the default 10 s hook timeout is too tight).
afterAll(async () => {
  await Promise.all(orgs.map((o) => deletePrefix(`orgs/${o}/`)));
  await f.cleanup();
}, 120_000);

describe.skipIf(!ready)("reviewer playback routes", { timeout: 60_000 }, () => {
  it("serves rewritten playlists and 302 segments while the claim is live", async () => {
    const { scout, claimId } = await claimedWithHls("live");
    current = scout;
    const res = await getMaster(claimId);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const text = await res.text();
    expect(text).toContain(`/api/review/claims/${claimId}/hls/720p/index.m3u8`);
    expect(text).not.toContain("/api/matches/");
    expect(text).not.toMatch(/orgs\//);

    const media = await getFile(claimId, "720p", "index.m3u8");
    expect(media.status).toBe(200);
    const mediaText = await media.text();
    expect(mediaText).toContain(`/api/review/claims/${claimId}/hls/720p/init.mp4`);
    expect(mediaText).toContain(`/api/review/claims/${claimId}/hls/720p/seg_00000.m4s`);

    const seg = await getFile(claimId, "720p", "seg_00000.m4s");
    expect(seg.status).toBe(302);
    expect(seg.headers.get("location")).toMatch(/X-Amz-Expires=60/);
    expect(seg.headers.get("cache-control")).toContain("no-store");
  });

  it("answers 404 to another scout, an unknown file and an unknown claim", async () => {
    const { claimId } = await claimedWithHls("owner");
    current = await reviewer(f, "playback other");
    expect((await getMaster(claimId)).status).toBe(404);
    expect((await getFile(claimId, "720p", "seg_00000.m4s")).status).toBe(404);
    expect((await getMaster("no-such-claim")).status).toBe(404);
  });

  // One HLS seed per test: a seed can take over 10 s on a loaded host.
  it("answers 404 after a release", async () => {
    const released = await claimedWithHls("released");
    current = released.scout;
    expect((await getMaster(released.claimId)).status).toBe(200);
    await releaseClaim(released.scout, released.claimId);
    expect((await getMaster(released.claimId)).status).toBe(404);
    expect((await getFile(released.claimId, "720p", "index.m3u8")).status).toBe(404);
  });

  it("answers 404 after the claim runs out", async () => {
    const expired = await claimedWithHls("expired");
    current = expired.scout;
    // The claim's end moved into the past: ended on the next request, before any sweep.
    await rawDb.reviewClaim.update({
      where: { id: expired.claimId },
      data: {
        claimedAt: new Date(Date.now() - 49 * 3600_000),
        expiresAt: new Date(Date.now() - 3600_000),
      },
    });
    expect((await getMaster(expired.claimId)).status).toBe(404);
    expect((await getFile(expired.claimId, "720p", "seg_00000.m4s")).status).toBe(404);
  });

  it("answers 401 signed out and 403 to a scout who may not review", async () => {
    const { scout, claimId } = await claimedWithHls("guard");
    current = null;
    expect((await getMaster(claimId)).status).toBe(401);
    current = scout;
    await rawDb.scoutProfile.update({
      where: { userId: scout.user.id },
      data: { status: "suspended", suspendedAt: new Date(), suspensionReason: "Test" },
    });
    expect((await getMaster(claimId)).status).toBe(403);
  });
});

const getClip = (claimId: string, clipId: string) =>
  clipRoute.GET(new Request(`http://test/api/review/claims/${claimId}/clips/${clipId}`), {
    params: Promise.resolve({ claimId, clipId }),
  });

async function clipOf(
  m: Awaited<ReturnType<typeof ws.workspaceMatch>>,
  playerId: string | null = null,
) {
  const t = playerId ? await ws.track(m, { side: "home", playerId }) : null;
  const e = await ws.cvEvent(m, {
    status: "auto_accepted",
    confidence: 0.99,
    trackId: t?.id ?? null,
    playerId,
  });
  const base = new Date(Date.now() + 14 * 86_400_000);
  return rawDb.clip.create({
    data: {
      organisationId: m.organisationId,
      matchId: m.matchId,
      eventId: e.id,
      blobPath: `orgs/${m.organisationId}/matches/${m.matchId}/clips/${e.id}.mp4`,
      startMs: 0,
      endMs: 10_000,
      sizeBytes: BigInt(1000),
      width: 1280,
      height: 720,
      baseExpiresAt: base,
      expiresAt: base,
    },
  });
}

describe.skipIf(!hasStorage)("reviewer clip route (C11)", { timeout: 60_000 }, () => {
  it("answers 302 for the claim's clips and 404 for anything else", async () => {
    const m = await ws.workspaceMatch(f, "Clip route");
    orgs.push(m.organisationId);
    const other = await ws.workspaceMatch(f, "Clip other");
    const named = await ws.sidePlayer(m, "home", 7, "club_only");
    const teamClip = await clipOf(m);
    const playerClip = await clipOf(m, named.playerId);
    const deleted = await clipOf(m);
    await rawDb.clip.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    const theirs = await clipOf(other);
    const { scout, claimId } = await ws.claimed(f, m, "clip route");
    current = scout;

    const ok = await getClip(claimId, teamClip.id);
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toMatch(/X-Amz-Expires=60/);
    expect(ok.headers.get("location")).toContain("response-content-type=video%2Fmp4");
    expect(ok.headers.get("cache-control")).toContain("no-store");
    // A club_only player may be attributed: their clip is served.
    expect((await getClip(claimId, playerClip.id)).status).toBe(302);
    expect((await getClip(claimId, deleted.id)).status).toBe(404);
    expect((await getClip(claimId, theirs.id)).status).toBe(404);

    // Consent withdrawn (the purge not yet run): the player's clip is refused.
    await rawDb.consent.create({
      data: {
        organisationId: m.organisationId,
        playerId: named.playerId,
        state: "withdrawn",
        clubStats: false,
        scoutVisible: false,
        grantedBy: "Thandi Guardian",
        relationship: "parent",
        method: "paper_form",
        wordingVersion: "test",
        playerWasMinor: true,
        grantedAt: new Date(),
        withdrawnAt: new Date(),
      },
    });
    expect((await getClip(claimId, playerClip.id)).status).toBe(404);

    current = await reviewer(f, "clip route other");
    expect((await getClip(claimId, teamClip.id)).status).toBe(404);
  });
});

describe.skipIf(!ready)(
  "access after Mark as reviewed (C11, REVIEW11)",
  { timeout: 60_000 },
  () => {
    it("answers 404 on every playback route once the review is submitted", async () => {
      const m = await ws.workspaceMatch(f, "Submitted playback");
      orgs.push(m.organisationId);
      await seedHls(m.organisationId, m.matchId, m.videoId);
      const clip = await clipOf(m);
      const { scout, claimId } = await ws.claimed(f, m, "submitted playback");
      current = scout;
      expect((await getMaster(claimId)).status).toBe(200);
      expect((await getFile(claimId, "720p", "seg_00000.m4s")).status).toBe(302);
      expect((await getClip(claimId, clip.id)).status).toBe(302);

      await submitReview(scout, (await claimScope(scout, claimId))!);
      expect((await getMaster(claimId)).status).toBe(404);
      expect((await getFile(claimId, "720p", "index.m3u8")).status).toBe(404);
      expect((await getFile(claimId, "720p", "seg_00000.m4s")).status).toBe(404);
      expect((await getClip(claimId, clip.id)).status).toBe(404);
    });
  },
);
