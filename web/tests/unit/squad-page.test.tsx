import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The squad list (/squad, C04): the status tabs read "Current 1 players" to a
// screen reader, the phone card keeps each number with its unit, and the
// full-width Show button centres its label.

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  requirePageRole: vi.fn(async () => ({
    organisationName: "Wideline Demo FC",
    organisationType: "club",
    roles: ["coach"],
  })),
}));

const team = (id: string, name: string) => ({
  id,
  name,
  ageGroup: null,
  gender: null,
  season: "2026",
  isOpposition: false,
  activeCount: 1,
});

vi.mock("@/server/squad/teams", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/squad/teams")>()),
  listTeams: vi.fn(async () => ({
    own: [team("t-1", "U15 Boys"), team("t-2", "U16 Boys")],
    opposition: [],
  })),
}));

vi.mock("@/server/squad/players", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/squad/players")>()),
  countPlayers: vi.fn(async () => ({ current: 1, departed: 0 })),
  listPlayers: vi.fn(async () => [
    {
      id: "p-1",
      firstName: "Thabo",
      lastName: "Nkosi",
      isPlaceholder: false,
      dateOfBirth: new Date("2011-03-14"),
      position: null,
      preferredFoot: null,
      heightCm: 165,
      squadNumber: 7,
      clubStatus: "active",
      departedAt: null,
      teamId: "t-1",
      team: { id: "t-1", name: "U15 Boys", season: "2026", isOpposition: false },
    },
  ]),
}));

const SquadPage = (await import("@/app/(app)/squad/page")).default as (props: {
  searchParams: Promise<Record<string, string>>;
}) => Promise<ReactNode>;

const render = async () =>
  renderToStaticMarkup(await SquadPage({ searchParams: Promise.resolve({}) }));

describe("/squad", () => {
  it("spaces the status tab's label, count and sr-only word", async () => {
    const html = await render();
    expect(html).toContain(
      'Current <span class="data">1</span> <span class="sr-only">players</span>',
    );
  });

  it("joins numbers to their units with a non-breaking space in the phone card", async () => {
    const html = await render();
    expect(html).toContain("No.\u00a07");
    expect(html).toMatch(/Age\u00a0\d+/);
    expect(html).toContain("165\u00a0cm");
  });

  it("centres the label of the full-width Show button", async () => {
    const html = await render();
    expect(html).toMatch(
      /<button type="submit" class="[^"]*\bjustify-center\b[^"]*">Show<\/button>/,
    );
  });
});
