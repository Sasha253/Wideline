import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/generated/prisma/enums";
import type { OrganisationSummary, UserContext } from "@/server/auth/session";

// App shell (D02, restyled for Floodlight): nav by role and grouped per role, counts only where
// action is waiting, skip link, no-organisation state, org switcher, account menu with the theme
// radio, the logo, and the tab bar's More. Client components render to static markup; popovers are opened by
// mocking usePopover.

const state = vi.hoisted(() => ({ pathname: "/dashboard", popoverOpen: false }));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/(app)/organisations/actions", () => ({ switchOrganisation: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut: vi.fn() } }));
vi.mock("@/components/shell/usePopover", () => ({
  usePopover: () => ({
    open: state.popoverOpen,
    close: () => {},
    panelId: "panel",
    wrapperProps: {},
    triggerProps: { "aria-expanded": state.popoverOpen, onClick: () => {} },
    panelProps: { id: "panel" },
  }),
}));

const { AppShell } = await import("@/components/shell/AppShell");
const { OrgSwitcher, orgInitials } = await import("@/components/shell/OrgSwitcher");
const { personInitials } = await import("@/components/shell/AccountMenu");
const { Logo, LogoMark } = await import("@/components/ui/Logo");

const DEMO: OrganisationSummary = {
  id: "org-demo",
  name: "Wideline Demo FC",
  type: "club",
  country: "ZA",
  region: null,
  roles: ["owner"],
};
const LAB: OrganisationSummary = {
  id: "org-lab",
  name: "Wideline Lab",
  type: "platform",
  country: "ZA",
  region: null,
  roles: ["platform_admin"],
};

function context(roles: Role[], organisations: OrganisationSummary[] = [DEMO]): UserContext {
  const active = organisations[0]!;
  return {
    sessionId: "s1",
    user: { id: "u1", name: "Thandi Mokoena", email: "thandi@example.com" },
    impersonator: null,
    organisations,
    organisationId: active.id,
    organisationName: active.name,
    organisationType: active.type,
    roles,
    db: {} as never,
  };
}

const noOrganisation: UserContext = {
  sessionId: "s1",
  user: { id: "u1", name: "Thandi Mokoena", email: "thandi@example.com" },
  impersonator: null,
  organisations: [],
  organisationId: null,
  organisationName: null,
  organisationType: null,
  roles: [],
  db: null,
};

const shell = (ctx: UserContext) =>
  renderToStaticMarkup(
    <AppShell ctx={ctx}>
      <h1>Page</h1>
    </AppShell>,
  );

/** The markup of the first element that opens with `open`, up to its closing tag. */
function section(html: string, open: string, tag: string): string {
  const start = html.indexOf(open);
  if (start < 0) return "";
  return html.slice(start, html.indexOf(`</${tag}>`, start) + tag.length + 3);
}

const sidebarNav = (html: string) =>
  section(html, '<nav aria-label="Main" class="wl-sidebar__nav"', "nav");
const tabBar = (html: string) => section(html, '<nav aria-label="Main" class="wl-tabbar"', "nav");
const navLabels = (nav: string) =>
  [...nav.matchAll(/<span class="wl-nav__label">([^<]+)<\/span>/g)].map((m) => m[1]);
const navHeadings = (nav: string) =>
  [...nav.matchAll(/<p id="[^"]+" class="wl-nav__heading">([^<]+)<\/p>/g)].map((m) => m[1]);

beforeEach(() => {
  state.pathname = "/dashboard";
  state.popoverOpen = false;
});

describe("AppShell", () => {
  it("shows a coach only the club items", () => {
    const html = shell(context(["coach"]));
    expect(navLabels(sidebarNav(html))).toEqual(["Dashboard", "Squad", "Matches"]);
    for (const label of ["Settings", "Admin", "Lab", "Review queue"]) {
      expect(html).not.toContain(`>${label}<`);
    }
  });

  it("shows a scout only the review queue, shortlists and their scout profile", () => {
    const html = shell(context(["scout"]));
    expect(navLabels(sidebarNav(html))).toEqual(["Review queue", "Shortlists", "Scout profile"]);
  });

  it("starts with a skip link to #main, and main can take focus", () => {
    const html = shell(context(["owner"]));
    expect(html.indexOf('href="#main"')).toBeLessThan(html.indexOf("<aside"));
    expect(html).toMatch(/<a class="wl-skip[^"]*" href="#main">Skip to content<\/a>/);
    expect(html).toMatch(/<main id="main" tabindex="-1"/);
  });

  it("marks the current item with aria-current", () => {
    state.pathname = "/settings/members";
    const nav = sidebarNav(shell(context(["owner"])));
    expect(nav).toMatch(/aria-current="page" href="\/settings\/organisation"/);
    expect(nav.match(/aria-current/g)).toHaveLength(1);
  });

  it("renders no nav, switcher or tab bar without an organisation", () => {
    const html = shell(noOrganisation);
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("wl-switcher");
    expect(html).not.toContain("wl-tabbar");
    expect(html).toContain("Thandi Mokoena");
    expect(html).toContain("Sign out");
  });

  it("renders an empty sidebar nav and no tab bar for a role with no items", () => {
    const html = shell(context(["guardian"]));
    expect(sidebarNav(html)).toBe('<nav aria-label="Main" class="wl-sidebar__nav"></nav>');
    expect(tabBar(html)).toBe("");
    expect(html).not.toContain("wl-main--tabbar");
  });

  it("puts 5 items or fewer straight into the tab bar", () => {
    const bar = tabBar(shell(context(["owner"])));
    expect(bar.match(/<a /g)).toHaveLength(4);
    expect(bar).not.toContain("More");
  });

  it("shows 4 tab bar links plus More for 6 items", () => {
    const bar = tabBar(shell(context(["owner", "scout"])));
    expect(bar.match(/<a /g)).toHaveLength(4);
    expect(bar).toMatch(/<button type="button" aria-expanded="false" class="wl-tabbar__item"/);
    expect(bar).toContain(">More<");
  });

  it("marks More as current when the current page sits under it", () => {
    state.pathname = "/shortlists";
    const bar = tabBar(shell(context(["owner", "scout"])));
    expect(bar).toMatch(/class="wl-tabbar__item" aria-current="true"/);
  });
});

describe("OrgSwitcher", () => {
  const organisations = [
    { id: "org-demo", name: "Wideline Demo FC", typeLabel: "Club", rolesLabel: "Owner" },
    {
      id: "org-lab",
      name: "Wideline Lab",
      typeLabel: "Wideline platform",
      rolesLabel: "Platform admin",
    },
    { id: "org-hel", name: "Hellenic", typeLabel: "Academy", rolesLabel: "Scout" },
  ];

  it("renders no button for a single organisation", () => {
    for (const variant of ["sidebar", "rail", "topbar"] as const) {
      const html = renderToStaticMarkup(
        <OrgSwitcher organisations={[organisations[0]!]} currentId="org-demo" variant={variant} />,
      );
      expect(html).not.toContain("<button");
      expect(html).toContain("Wideline Demo FC");
    }
  });

  it("names the trigger after the current organisation", () => {
    const html = renderToStaticMarkup(
      <OrgSwitcher organisations={organisations} currentId="org-demo" variant="sidebar" />,
    );
    expect(html).toContain('aria-label="Organisation: Wideline Demo FC. Switch organisation"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("marks the current organisation and offers a form for each other one", () => {
    state.popoverOpen = true;
    const html = renderToStaticMarkup(
      <OrgSwitcher organisations={organisations} currentId="org-demo" variant="sidebar" />,
    );
    const current = section(html, '<li aria-current="true">', "li");
    expect(current).toContain("Wideline Demo FC");
    expect(current).toContain(">Current<");
    expect(current).not.toContain("<form");
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);

    const hidden = [
      ...html.matchAll(/<input type="hidden" name="organisationId" value="([^"]+)"/g),
    ];
    expect(hidden.map((m) => m[1])).toEqual(["org-lab", "org-hel"]);
    expect(html).toContain('<span class="sr-only">Switch to </span>');
    expect(html).toContain("Academy · Scout");
    expect(html).toContain("You join organisations by invitation from their admin.");
  });

  it("makes initials from the first two words, or the first two letters", () => {
    expect(orgInitials("Wideline Demo FC")).toBe("WD");
    expect(orgInitials("Hellenic")).toBe("HE");
    expect(orgInitials("  orlando   pirates ")).toBe("OP");
  });
});

describe("shell with two organisations", () => {
  it("renders the switcher trigger in every width variant", () => {
    const html = shell(context(["owner"], [DEMO, LAB]));
    const label = "Organisation: Wideline Demo FC. Switch organisation";
    // Sidebar and top bar use aria-label; the rail avatar is named by sr-only text.
    expect(html.split(`aria-label="${label}"`)).toHaveLength(3);
    expect(html).toContain(`<span class="sr-only">${label}</span>`);
    expect(html.match(/data-testid="active-organisation"/g)).toHaveLength(1);
  });
});

describe("Floodlight shell", () => {
  it("shows one group per role, headed, only when there is more than one", () => {
    const single = sidebarNav(shell(context(["owner"])));
    expect(navHeadings(single)).toEqual([]);

    const both = sidebarNav(shell(context(["owner", "scout"])));
    expect(navHeadings(both)).toEqual(["Wideline Demo FC", "Scouting"]);
    expect(navLabels(both)).toEqual([
      "Dashboard",
      "Squad",
      "Matches",
      "Settings",
      "Review queue",
      "Shortlists",
      "Scout profile",
    ]);
  });

  it("puts Wideline staff below any other role", () => {
    const nav = sidebarNav(shell(context(["platform_admin", "scout"])));
    expect(navHeadings(nav)).toEqual(["Scouting", "Wideline staff"]);
    expect(navLabels(nav).slice(-2)).toEqual(["Admin", "Lab"]);
  });

  it("shows a count only where action is waiting, with its words for screen readers", () => {
    const html = renderToStaticMarkup(
      <AppShell
        ctx={context(["owner"])}
        counts={{
          matches: { count: 2, hint: "2 need a lineup" },
          squad: { count: 0, hint: "nothing" },
        }}
      >
        <p>Page</p>
      </AppShell>,
    );
    const nav = sidebarNav(html);
    expect(nav.match(/class="wl-nav__count"/g)).toHaveLength(1);
    expect(nav).toContain('<span class="wl-nav__count" aria-hidden="true">2</span>');
    expect(nav).toContain('<span class="sr-only">, 2 need a lineup</span>');
    expect(nav).not.toContain("nothing");
    expect(tabBar(html).match(/class="wl-tabbar__count"/g)).toHaveLength(1);
  });

  it("shows no count without counts", () => {
    const html = shell(context(["owner", "scout"]));
    expect(html).not.toContain("wl-nav__count");
    expect(html).not.toContain("wl-tabbar__count");
  });

  it("gives every rail item a tooltip hidden from screen readers", () => {
    const nav = sidebarNav(shell(context(["coach"])));
    expect(nav.match(/<span class="wl-tooltip" aria-hidden="true">/g)).toHaveLength(3);
  });

  it("shortens Review queue to Queue in the tab bar only", () => {
    const html = shell(context(["scout"]));
    expect(tabBar(html)).toContain('<span class="wl-tabbar__label">Queue</span>');
    expect(navLabels(sidebarNav(html))).toContain("Review queue");
  });

  it("names the account trigger and offers the theme radio and Sign out", () => {
    const html = shell(context(["owner"]));
    expect(html).toContain("Account and theme");
    expect(html.match(/role="radiogroup"/g)?.length).toBeGreaterThan(0);
    const radio = section(html, '<div role="radiogroup"', "div");
    for (const label of ["Dark", "Light", "Match system"]) expect(html).toContain(label);
    expect(radio).toMatch(/checked="" value="dark"/);
    expect(html).toContain(
      "Dark is the default. The review workspace stays dark unless you choose Light here.",
    );
    expect(html).toContain("Sign out");
    // No page registered a shortcut list, so the item is not offered.
    expect(html).not.toContain("Keyboard shortcuts");
  });

  it("makes account initials from the first and last name", () => {
    expect(personInitials("Nomvula Mthembu")).toBe("NM");
    expect(personInitials("Thandi Lerato Mokoena")).toBe("TM");
    expect(personInitials("cher")).toBe("C");
  });

  it("draws the wide-channel logo with the lime touchline and the wordmark", () => {
    const html = renderToStaticMarkup(<Logo />);
    expect(html).toContain('width="46" height="22" viewBox="0 0 46 22"');
    expect(html).toContain(
      '<rect x="0" y="18" width="46" height="4" stroke="none" class="wl-logo__bar">',
    );
    expect(html).toContain('<span class="wl-logo__word">Wideline</span>');
    expect(renderToStaticMarkup(<LogoMark size="s" />)).toContain('width="30" height="14"');
  });
});
