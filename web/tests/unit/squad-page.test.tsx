import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The squad list (/squad, C04; Floodlight "Squad"): team tabs with counts, consent filters
// that never rely on colour alone, a table on desktop and initials-or-number rows on phones
// (never a photo), and a search that works without JavaScript.

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
      consentState: "club_only",
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
  it("names the team tabs and puts the count beside the current tab's label", async () => {
    const html = await render();
    expect(html).toContain('aria-label="Teams"');
    expect(html).toMatch(
      /aria-current="page"[^>]*>All teams<span class="wl-tabset__count">1<\/span>/,
    );
    expect(html).toContain('Departed<span class="wl-tabset__count">0</span>');
  });

  it("filters by consent with an icon and a word on every option", async () => {
    const html = await render();
    expect(html).toContain('aria-label="Consent"');
    for (const word of ["All", "Given", "Club only", "Awaiting", "Withdrawn", "Not requested"]) {
      expect(html).toContain(word);
    }
  });

  it("shows the shirt number or initials on phone rows, never a photo", async () => {
    const html = await render();
    expect(html).toContain("Thabo Nkosi");
    expect(html).toMatch(/>7<\/span>/);
    expect(html).not.toContain("<img");
  });

  it("searches with a plain GET form", async () => {
    const html = await render();
    const form = html.match(/<form [^>]*role="search"[^>]*>/)?.[0] ?? "";
    expect(form).toContain('method="get"');
    expect(form).toContain('action="/squad"');
    expect(html).toContain('<span class="sr-only">Search players</span>');
  });
});
