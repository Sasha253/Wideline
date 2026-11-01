import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueRow } from "@/server/review/queue";

// Q-064 (docs/build/design/C10.md, '"Log in as" sessions'): in a "Log in as"
// session the claim page shows the warn banner in place of the claim form, and
// the claimed page shows it in place of the Release trigger. A conflict or a
// reached limit still takes precedence, because it applies to the scout too.
// claimMatch() and releaseClaim() refuse on the server as well
// (tests/integration/review-claims.test.ts).

const HOUR = 60 * 60 * 1000;
const now = Date.now();

const row = (over: Partial<QueueRow> = {}): QueueRow => ({
  matchId: "m-1",
  organisationId: "o-1",
  organisationName: "Hilton College",
  playedAt: new Date("2026-10-18T10:00:00+02:00"),
  competition: "Pilot league",
  ageGroup: "U15",
  halfLengthMinutes: 35,
  homeTeam: { name: "Hilton College U15" },
  awayTeam: { name: "Visitors U15" },
  videoId: "v-1",
  rawExpiresAt: new Date(now + 100 * HOUR),
  clipsOnly: false,
  durationSec: 4200,
  toCheck: 3,
  conflicted: false,
  ...over,
});

const state = {
  impersonator: null as { id: string; name: string; email: string } | null,
  row: row(),
};

vi.mock("@/server/auth/reviewer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/reviewer")>()),
  requireReviewerPage: vi.fn(async () => ({
    user: { id: "u-scout", name: "Scout", email: "scout@test.local" },
    impersonator: state.impersonator,
    scout: { id: "s-1", status: "approved", termsVersion: "x" },
  })),
}));

vi.mock("@/server/review/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/review/queue")>()),
  ownLiveClaimId: vi.fn(async () => null),
  queueMatch: vi.fn(async () => ({ row: state.row, claimLimit: 1, atLimit: false })),
}));

vi.mock("@/server/review/claims", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/review/claims")>()),
  ownClaim: vi.fn(async () => ({
    claimId: "c-1",
    status: "active",
    releaseReason: null,
    claimedAt: new Date(now - HOUR),
    expiresAt: new Date(now + 47 * HOUR),
    endedAt: null,
    match: row(),
  })),
}));

// C11: the claimed page reads the workspace through claimScope(). In a real
// "Log in as" session ctx.user is the scout, so claimScope() matches the
// claim's scoutUserId; here it and the workspace reads are stubbed (no DB).
vi.mock("@/server/review/scope", () => ({
  claimScope: vi.fn(async () => ({
    claim: {
      id: "c-1",
      organisationId: "o-1",
      matchId: "m-1",
      videoId: "v-1",
      claimedAt: new Date(now - HOUR),
      expiresAt: new Date(now + 47 * HOUR),
    },
    db: {},
  })),
}));

vi.mock("@/server/review/workspace", () => ({
  loadWorkspace: vi.fn(async () => ({
    match: { id: "m-1", halfLengthMinutes: 35 },
    video: {
      durationMs: 4_200_000,
      hls: true,
      section: "waiting",
      markers: { kickoffMs: 0, halfTimeMs: null, secondHalfKickoffMs: null, fullTimeMs: null },
    },
    entries: [{ id: "l-7", side: "home", shirtNumber: 7, label: "Home #7" }],
    tracks: [{ id: "t-1", index: 22, side: "home", entryId: "l-7" }],
    events: [
      {
        id: "e-1",
        timestampMs: 60_000,
        type: "shot",
        onTarget: true,
        status: "pending_review",
        side: "home",
        trackId: "t-1",
        entryId: "l-7",
        confidence: 0.6,
        clipId: "clip-1",
        clipStartMs: 55_000,
        clipEndMs: 65_000,
        corrected: false,
        manual: false,
        toCheck: true,
      },
    ],
  })),
  claimFacts: vi.fn(async () => ({
    thresholds: { goal: 0.9, shot: 0.75, touch: 0.8 },
    sidesUnconfirmed: false,
    favouritedClipIds: [],
    counts: { eventsReviewed: 0, corrections: 0, added: 0 },
  })),
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const { IMPERSONATION_REFUSED, REVIEW_ERROR_COPY } = await import("@/server/review/errors");
const { IMPERSONATION_REVIEW_REFUSED } =
  await import("@/app/(app)/review/claims/[claimId]/ReviewWorkspace");
const ClaimMatchPage = (await import("@/app/(app)/review/matches/[matchId]/claim/page")).default;
const ClaimedMatchPage = (await import("@/app/(app)/review/claims/[claimId]/page")).default;

const admin = { id: "u-admin", name: "Admin", email: "admin@test.local" };

const claimPage = async () =>
  renderToStaticMarkup(await ClaimMatchPage({ params: Promise.resolve({ matchId: "m-1" }) }));
const claimedPage = async () =>
  renderToStaticMarkup(
    await ClaimedMatchPage({
      params: Promise.resolve({ claimId: "c-1" }),
      searchParams: Promise.resolve({}),
    }),
  );

beforeEach(() => {
  state.impersonator = null;
  state.row = row();
});

describe('review pages in a "Log in as" session (Q-064)', () => {
  it("the claim page shows the warn banner and no claim form", async () => {
    state.impersonator = admin;
    const html = await claimPage();
    expect(html).toContain(IMPERSONATION_REFUSED);
    // Banner tone="warn": the plain wl-banner with role status, not danger.
    expect(html).toContain('<div class="wl-banner" role="status">');
    expect(html).not.toContain("wl-banner--danger");
    expect(html).not.toContain('name="declaration"');
    expect(html).toContain("Back to the review queue");
  });

  it("a conflict takes precedence over the impersonation banner", async () => {
    state.impersonator = admin;
    state.row = row({ conflicted: true });
    const html = await claimPage();
    expect(html).toContain(REVIEW_ERROR_COPY.conflict);
    expect(html).not.toContain(IMPERSONATION_REFUSED);
  });

  it("the claimed page shows the warn banner in place of Release", async () => {
    state.impersonator = admin;
    const html = await claimedPage();
    expect(html).toContain(IMPERSONATION_REFUSED);
    expect(html).toContain('<div class="wl-banner" role="status">');
    expect(html).not.toContain("Release match");
  });

  it("the claimed page renders the workspace read-only (AUTH06, AUTH07)", async () => {
    state.impersonator = admin;
    const html = await claimedPage();
    expect(html).toContain(IMPERSONATION_REVIEW_REFUSED);
    // The event list is there; no write control is.
    expect(html).toContain("Home #7");
    expect(html).not.toContain("Mark as reviewed");
    expect(html).not.toContain("Add missed event");
    expect(html).not.toMatch(/>Confirm</);
    expect(html).not.toMatch(/>Reject</);
    // No closed write dialog either: edit and track link are not mounted.
    expect(html).not.toContain("Save and confirm");
    expect(html).not.toContain("Unlink track");
    expect(html).toContain("J, K and ? work");
  });

  it("the scout's own session keeps the Release trigger and no banner", async () => {
    const html = await claimedPage();
    expect(html).not.toContain(IMPERSONATION_REFUSED);
    expect(html).not.toContain(IMPERSONATION_REVIEW_REFUSED);
    expect(html).toContain("Release match");
    expect(html).toContain("Mark as reviewed");
    expect(html).toContain("Save and confirm");
    expect(html).toContain("J, K, Y, N, E, A and ? work");
  });
});
