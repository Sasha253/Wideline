import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rawDb } from "@/server/db/raw";
import { claimMatch } from "@/server/review/claims";
import { alertExpiringReviews } from "@/server/review/alerts";
import { platformAdmin, platformAdminEmails } from "./helpers/cv";
import { fixtures } from "./helpers/fixtures";
import { lineupPlayer, reviewer, reviewMatch } from "./helpers/review";

// C10 (REVIEW13, A-13): platform admins are emailed once per video when an
// unreviewed match has 48 hours or less of raw footage left. A failed send
// gives the claim (Video.reviewAlertedAt) back, so the next sweep retries. The
// email carries ids only, never team or player names.

const deliverMail = vi.hoisted(() =>
  vi.fn<(to: string, subject: string, text: string) => Promise<void>>(async () => {}),
);
vi.mock("@/server/mail-transport", () => ({ deliverMail }));

const f = fixtures();
const HOUR = 60 * 60 * 1000;
const now = new Date();

const sentFor = (videoId: string) =>
  deliverMail.mock.calls
    .filter((c) => String(c[2]).includes(videoId))
    .map((c) => ({ to: c[0], subject: c[1], text: c[2] }));
const alertedAt = async (videoId: string) =>
  (await rawDb.video.findUniqueOrThrow({ where: { id: videoId } })).reviewAlertedAt;

beforeAll(async () => {
  await platformAdmin(f);
});

afterAll(async () => {
  await f.cleanup();
});

describe("alertExpiringReviews", { timeout: 30_000 }, () => {
  it("alerts every platform admin once for an awaiting match at 47 h", async () => {
    const m = await reviewMatch(f, "Alert Waiting", {
      now,
      expiresInMs: 47 * HOUR,
      homeName: "Secretname Academy U15",
    });
    await lineupPlayer(m, "Ayanda", "Zulu");
    deliverMail.mockClear();
    await alertExpiringReviews(now);
    const sent = sentFor(m.videoId);
    expect(sent.map((s) => s.to).sort()).toEqual(await platformAdminEmails());
    expect(await alertedAt(m.videoId)).not.toBeNull();
    for (const s of sent) {
      expect(s.text).toContain(m.matchId);
      expect(s.text).toContain(m.organisationId);
      expect(`${s.subject}\n${s.text}`).not.toMatch(/Secretname|Visitors|Ayanda|Zulu/);
    }

    deliverMail.mockClear();
    await alertExpiringReviews(now);
    expect(sentFor(m.videoId)).toHaveLength(0);
  });

  it("alerts an in-review match too, naming the claim by id", async () => {
    const scout = await reviewer(f, "alerts");
    const m = await reviewMatch(f, "Alert Claimed", { now, expiresInMs: 30 * HOUR });
    const { claimId } = await claimMatch(scout, m.matchId, { declaration: true });
    deliverMail.mockClear();
    await alertExpiringReviews(now);
    const sent = sentFor(m.videoId);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent[0]!.text).toContain(claimId);
    expect(sent[0]!.text).not.toContain(scout.user.name);
  });

  it("does not alert at 49 h, or for a published match", async () => {
    const later = await reviewMatch(f, "Alert Later", { now, expiresInMs: 49 * HOUR });
    const published = await reviewMatch(f, "Alert Published", {
      now,
      expiresInMs: 10 * HOUR,
      status: "published",
    });
    deliverMail.mockClear();
    await alertExpiringReviews(now);
    expect(sentFor(later.videoId)).toHaveLength(0);
    expect(sentFor(published.videoId)).toHaveLength(0);
    expect(await alertedAt(later.videoId)).toBeNull();
    expect(await alertedAt(published.videoId)).toBeNull();
  });

  it("gives the claim back when the mail fails, so the next run retries", async () => {
    const m = await reviewMatch(f, "Alert Retry", { now, expiresInMs: 20 * HOUR });
    deliverMail.mockClear();
    deliverMail.mockRejectedValue(new Error("smtp down"));
    await alertExpiringReviews(now);
    expect(await alertedAt(m.videoId)).toBeNull();

    deliverMail.mockReset();
    deliverMail.mockImplementation(async () => {});
    await alertExpiringReviews(now);
    expect(sentFor(m.videoId).length).toBeGreaterThanOrEqual(1);
    expect(await alertedAt(m.videoId)).not.toBeNull();
  });
});
