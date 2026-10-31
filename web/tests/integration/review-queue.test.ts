import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db/raw";
import { claimMatch } from "@/server/review/claims";
import { QUEUE_CAP, queueMatch, reviewQueue, type QueueRow } from "@/server/review/queue";
import { fixtures } from "./helpers/fixtures";
import { affiliation, lineupPlayer, reviewer, reviewMatch } from "./helpers/review";

// C10 acceptance (REVIEW01, REVIEW13, A-3): the queue is ordered by raw footage
// expiry across organisations, clips-only matches have their own section, the
// Lab, the scout network, suspended clubs and matches not awaiting review are
// left out, conflicts reach the page as one flag, and rows carry match-level
// facts only (no players, no venue).

const f = fixtures();
const HOUR = 60 * 60 * 1000;
const now = new Date();

const ours = new Set<string>();
const mineOnly = (rows: QueueRow[]) => rows.filter((r) => ours.has(r.matchId));

let early: Awaited<ReturnType<typeof reviewMatch>>;
let late: Awaited<ReturnType<typeof reviewMatch>>;
let clips: Awaited<ReturnType<typeof reviewMatch>>;
let conflicted: Awaited<ReturnType<typeof reviewMatch>>;
const leftOut: string[] = [];

beforeAll(async () => {
  late = await reviewMatch(f, "Queue Late", { now, expiresInMs: 60 * HOUR, toCheck: 2 });
  early = await reviewMatch(f, "Queue Early", { now, expiresInMs: 20 * HOUR });
  // Same organisation as early, later expiry.
  conflicted = await reviewMatch(f, "Queue Conflict", {
    now,
    expiresInMs: 40 * HOUR,
    awayName: "Blocked Rovers U15",
  });
  clips = await reviewMatch(f, "Queue Clips", { now, expiresInMs: -HOUR, deleted: true });
  for (const m of [late, early, conflicted, clips]) ours.add(m.matchId);
  await lineupPlayer(late, "Naledi", "Khumalo");
  for (const opts of [
    { orgType: "platform" as const },
    { orgType: "scout_network" as const },
    { orgStatus: "suspended" as const },
    { status: "processing" as const },
    { status: "published" as const },
  ]) {
    const m = await reviewMatch(f, `Queue left out ${JSON.stringify(opts)}`, {
      now,
      expiresInMs: 10 * HOUR,
      ...opts,
    });
    leftOut.push(m.matchId);
    ours.add(m.matchId);
  }
});

afterAll(async () => {
  await f.cleanup();
});

describe("reviewQueue", { timeout: 30_000 }, () => {
  it("orders waiting matches from two organisations by raw expiry, soonest first", async () => {
    const scout = await reviewer(f, "order");
    const q = await reviewQueue(scout, { now });
    expect(mineOnly(q.waiting).map((r) => r.matchId)).toEqual([
      early.matchId,
      conflicted.matchId,
      late.matchId,
    ]);
    const all = q.waiting.map((r) => r.rawExpiresAt.getTime());
    expect([...all].sort((a, b) => a - b)).toEqual(all);
    expect(mineOnly(q.waiting).find((r) => r.matchId === late.matchId)).toMatchObject({
      toCheck: 2,
      halfLengthMinutes: 35,
      ageGroup: "U15",
      competition: "Pilot league",
      clipsOnly: false,
    });
  });

  it("puts matches whose raw footage is gone under clips only", async () => {
    const scout = await reviewer(f, "clips");
    const q = await reviewQueue(scout, { now });
    expect(mineOnly(q.clipsOnly).map((r) => r.matchId)).toEqual([clips.matchId]);
    expect(mineOnly(q.clipsOnly)[0]!.clipsOnly).toBe(true);
    expect(mineOnly(q.waiting).some((r) => r.matchId === clips.matchId)).toBe(false);
  });

  it("leaves out the Lab, the scout network, suspended clubs and matches not awaiting review", async () => {
    const scout = await reviewer(f, "left out");
    const q = await reviewQueue(scout, { now });
    const ids = [...q.waiting, ...q.clipsOnly].map((r) => r.matchId);
    for (const id of leftOut) expect(ids).not.toContain(id);
    for (const id of leftOut) expect(await queueMatch(scout, id, now)).toBeNull();
  });

  it("flags conflicted matches without saying why", async () => {
    const scout = await reviewer(f, "flag");
    await affiliation(scout.user.id, { type: "club", name: "Blocked Rovers" });
    const q = await reviewQueue(scout, { now });
    const rows = mineOnly(q.waiting);
    expect(rows.find((r) => r.matchId === conflicted.matchId)?.conflicted).toBe(true);
    expect(rows.filter((r) => r.matchId !== conflicted.matchId).every((r) => !r.conflicted)).toBe(
      true,
    );
    expect((await queueMatch(scout, conflicted.matchId, now))?.row.conflicted).toBe(true);
  });

  it("lists only the caller's own claims under mine, and the limit state", async () => {
    const a = await reviewer(f, "mine a");
    const b = await reviewer(f, "mine b");
    const m = await reviewMatch(f, "Queue Mine", { now, expiresInMs: 30 * HOUR });
    ours.add(m.matchId);
    const { claimId } = await claimMatch(a, m.matchId, { declaration: true });
    const qa = await reviewQueue(a);
    expect(qa.mine.map((r) => r.claimId)).toEqual([claimId]);
    expect(qa).toMatchObject({ claimLimit: 1, activeClaims: 1, atLimit: true });
    expect(qa.waiting.some((r) => r.matchId === m.matchId)).toBe(false);
    const qb = await reviewQueue(b);
    expect(qb.mine).toEqual([]);
    expect(qb.atLimit).toBe(false);
    expect([...qb.waiting, ...qb.clipsOnly].some((r) => r.matchId === m.matchId)).toBe(false);
    expect(await queueMatch(b, m.matchId)).toBeNull();
  });

  // REVIEW02, Q-053: a represented player blocks whatever the lineup player's
  // consent, on the queue row and the claim page alike. The row says only that
  // the match is conflicted: no name, no reason detail.
  it("a declared name blocks the row whatever the lineup player's consent", async () => {
    const hidden = await reviewMatch(f, "Queue Hidden", { now, expiresInMs: 5 * HOUR });
    await lineupPlayer(hidden, "Jane", "Doe", 4, "club_only");
    const never = await reviewMatch(f, "Queue Never", { now, expiresInMs: 5 * HOUR });
    await lineupPlayer(never, "John", "Roe", 5, "none");
    const visible = await reviewMatch(f, "Queue Visible", { now, expiresInMs: 5 * HOUR });
    await lineupPlayer(visible, "Thabo", "Nkosi", 9, "scout_visible");

    const clean = await reviewer(f, "represents clean");
    const agent = await reviewer(f, "represents agent");
    for (const name of ["Jane Doe", "john roe", "Thabo Nkosi"]) {
      await affiliation(agent.user.id, { type: "player", name });
    }
    for (const match of [hidden, never, visible]) {
      const asClean = (await reviewQueue(clean, { now })).waiting.find(
        (r) => r.matchId === match.matchId,
      );
      const asAgent = (await reviewQueue(agent, { now })).waiting.find(
        (r) => r.matchId === match.matchId,
      );
      expect(asClean?.conflicted).toBe(false);
      expect(asAgent?.conflicted).toBe(true);
      expect((await queueMatch(agent, match.matchId, now))?.row.conflicted).toBe(true);
      expect(JSON.stringify(asAgent)).not.toMatch(/jane|doe|john|roe|thabo|nkosi/i);
    }
  });

  it("holds no player names and no venue (A-3)", async () => {
    const scout = await reviewer(f, "facts");
    const q = await reviewQueue(scout, { now });
    const json = JSON.stringify(q);
    expect(json).not.toMatch(/Naledi|Khumalo/);
    expect(json).not.toMatch(/Secret venue/);
    expect(json).not.toMatch(/"venue"|"lineups?"|"firstName"|"lastName"/);
  });

  it("caps the queue at QUEUE_CAP", async () => {
    const scout = await reviewer(f, "cap");
    const q = await reviewQueue(scout, { now });
    expect(q.waiting.length + q.clipsOnly.length).toBeLessThanOrEqual(QUEUE_CAP);
    expect(QUEUE_CAP).toBe(200);
    const total = await rawDb.video.count({
      where: { status: "accepted", match: { status: "awaiting_review" } },
    });
    if (total < QUEUE_CAP) expect(q.capped).toBe(false);
  });
});
