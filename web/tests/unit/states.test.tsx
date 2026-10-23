// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { ForbiddenState } from "@/components/states/ForbiddenState";
import { DetailSkeleton, ListSkeleton, WorkspaceSkeleton } from "@/components/states/Skeleton";
import { DataTable } from "@/components/templates/DataTable";
import { DecisionChoice, DecisionFlow } from "@/components/templates/DecisionFlow";
import { DetailPage } from "@/components/templates/DetailPage";
import { ListPage } from "@/components/templates/ListPage";
import { PageHeader } from "@/components/templates/PageHeader";
import { Workspace } from "@/components/templates/Workspace";

// D02 shared states and page templates (docs/build/design/D02.md, Surfaces 5 and 6).

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const html = (node: ReactNode) => renderToStaticMarkup(node);

describe("Skeleton presets", () => {
  it.each([
    ["ListSkeleton", <ListSkeleton key="l" />],
    ["DetailSkeleton", <DetailSkeleton key="d" />],
    ["WorkspaceSkeleton", <WorkspaceSkeleton key="w" />],
  ])("%s announces loading and hides its blocks", (_name, node) => {
    const out = html(node);
    expect(out).toMatch(/^<div role="status" aria-busy="true"/);
    expect(out).toContain('<span class="sr-only">Loading…</span>');
    const blocks = out.match(/<span[^>]*class="wl-skeleton[^"]*"/g) ?? [];
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(block).toContain('aria-hidden="true"');
  });
});

describe("ErrorState", () => {
  let container: HTMLDivElement | null = null;
  afterEach(() => {
    container?.remove();
    container = null;
  });

  it("renders the copy and the reference", () => {
    const out = html(<ErrorState reset={() => {}} digest="a1b2c3" />);
    expect(out).toContain("<h1");
    expect(out).toContain("Something went wrong");
    expect(out).toContain("We could not load this page. Try again, or come back in a few minutes.");
    expect(out).toContain('Reference: <span class="data">a1b2c3</span>');
    expect(out).toContain("Go to your home page");
  });

  it("leaves out the reference without a digest", () => {
    expect(html(<ErrorState reset={() => {}} />)).not.toContain("Reference");
  });

  it("focuses the heading on mount and calls reset on Try again", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const reset = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<ErrorState reset={reset} />));

    expect(document.activeElement?.textContent).toBe("Something went wrong");
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Try again",
    );
    await act(async () => button!.click());
    expect(reset).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });
});

describe("EmptyState", () => {
  it("hides its art from screen readers", () => {
    const out = html(<EmptyState title="No matches waiting" body="New matches appear here." />);
    expect(out).toMatch(/<svg class="wl-empty__art"[^>]*aria-hidden="true"[^>]*focusable="false"/);
    expect(out).toContain('<h2 class="heading-2">No matches waiting</h2>');
  });

  it("can drop the art and use a level 1 heading", () => {
    const out = html(<EmptyState title="Page not found" art={false} headingLevel={1} />);
    expect(out).not.toContain("<svg");
    expect(out).toContain('<h1 class="heading-1">Page not found</h1>');
  });
});

describe("ForbiddenState", () => {
  it("keeps the C01 copy", () => {
    const out = html(<ForbiddenState />);
    expect(out).toContain("No access");
    expect(out).toContain(
      "Your account does not have access to this page. Ask a Wideline admin if you think you need\n        it.".replace(
        /\s+/g,
        " ",
      ),
    );
    expect(out).toContain('href="/login"');
    expect(out).toContain("Sign in as someone else");
  });

  it("shows the home link only with homeHref", () => {
    expect(html(<ForbiddenState />)).not.toContain("Go to your home page");
    const out = html(<ForbiddenState homeHref="/dashboard" />);
    expect(out).toMatch(/href="\/dashboard"[^>]*>.*Go to your home page/);
  });
});

describe("templates", () => {
  it("DataTable puts the table in a focusable, labelled region", () => {
    const out = html(
      <DataTable
        caption="Players, by name"
        columns={[
          { id: "name", header: "Name" },
          { id: "matches", header: "Matches", numeric: true },
        ]}
        rows={[{ id: "1", cells: ["Thabo Nkosi", 14] }]}
      />,
    );
    expect(out).toMatch(/<div role="region" aria-label="Players, by name" tabindex="0"/);
    expect(out).toContain('<caption class="sr-only">Players, by name</caption>');
    expect(out).toContain('<th scope="col" class="label num">Matches</th>');
    expect(out).toContain('<td class="data num">14</td>');
    expect(out).toContain('<td class="body">Thabo Nkosi</td>');
  });

  it("DataTable with cards hides the table on phones", () => {
    const out = html(
      <DataTable caption="Players" columns={[]} rows={[]} cards={<li className="wl-card">A</li>} />,
    );
    expect(out).toContain("hidden md:block");
    expect(out).toContain('<ul role="list" class="flex flex-col gap-3 md:hidden">');
  });

  it("DecisionFlow renders one h1 and radio inputs inside labels", () => {
    const out = html(
      <DecisionFlow
        question="Can scouts see Lebo's stats?"
        action="/x"
        submitLabel="Save my answer"
      >
        <DecisionChoice name="answer" value="yes" label="Yes" />
        <DecisionChoice name="answer" value="no" label="No" />
      </DecisionFlow>,
    );
    expect(out.match(/<h1/g)).toHaveLength(1);
    const labels = out.match(
      /<label class="wl-decision__choice body-lg"><input type="radio"[^>]*required/g,
    );
    expect(labels).toHaveLength(2);
    expect(out).toContain('<legend class="sr-only">Can scouts see Lebo&#x27;s stats?</legend>');
    expect(out).toContain('<form action="/x">');
  });

  it("PageHeader renders the back link, one h1 and the intro", () => {
    const out = html(
      <PageHeader
        title="Squad"
        eyebrow="Sample"
        intro="Players."
        back={{ href: "/", label: "Home" }}
      />,
    );
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toContain('<span class="sr-only">Back to </span>Home');
  });

  it("ListPage swaps the content for the empty state", () => {
    const out = html(
      <ListPage header={{ title: "Squad" }} isEmpty empty={<p>Empty</p>}>
        <p>Content</p>
      </ListPage>,
    );
    expect(out).toContain("Empty");
    expect(out).not.toContain("Content");
  });

  it("DetailPage reads its title once at each size and labels its sections", () => {
    const out = html(
      <DetailPage
        title="Thabo Nkosi"
        sections={[{ id: "log", title: "Match log", content: <p>Log</p> }]}
      />,
    );
    expect(out).toContain('<span class="heading-1 md:hidden">Thabo Nkosi</span>');
    expect(out).toContain('<span class="display-xl hidden md:inline">Thabo Nkosi</span>');
    expect(out).toMatch(
      /<section aria-labelledby="[^"]+" class="mt-8"><h2 id="[^"]+" class="heading-2">Match log<\/h2>/,
    );
  });

  it("Workspace labels both panes and can force the dark theme", () => {
    const out = html(
      <Workspace
        theme="dark"
        primary={{ title: "Match video", content: null }}
        side={{ title: "Events", content: null }}
      />,
    );
    expect(out).toMatch(/^<div data-theme="dark"/);
    expect(out.match(/<section aria-labelledby=/g)).toHaveLength(2);
    expect(out).toContain("wl-workspace__primary");
    expect(out).toContain("wl-workspace__side");
  });
});
