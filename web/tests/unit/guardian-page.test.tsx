import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GuardianView } from "@/server/consent/guardian";
import { CONSENT_WORDING_VERSION } from "@/server/consent/wording";

// The guardian screens (/consent/<token>, C05 Surface 1): the wording version
// shown on the about step is carried through every step (NFR09), the errors on
// the you step are linked to their controls, and the inactive closed view has
// its own copy.

const view = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/server/consent/guardian", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/consent/guardian")>()),
  guardianView: vi.fn(async () => view.current),
}));

const Page = (await import("@/app/consent/[token]/page")).default as (props: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string>>;
}) => Promise<ReactNode>;

const open = (extra: Partial<Extract<GuardianView, { requestId: string }>> = {}) => ({
  mode: "decide",
  reason: null,
  requestId: "r-1",
  organisationId: "o-1",
  playerId: "p-1",
  clubName: "Wideline Demo FC",
  firstName: "Lebo",
  minor: true,
  state: "requested",
  lastDecision: null,
  expiresAt: new Date("2026-11-07T00:00:00Z"),
  ...extra,
});

const render = async (sp: Record<string, string> = {}) =>
  renderToStaticMarkup(
    await Page({ params: Promise.resolve({ token: "tok" }), searchParams: Promise.resolve(sp) }),
  );

const hiddenWording = `<input type="hidden" name="wording" value="${CONSENT_WORDING_VERSION}"/>`;

beforeEach(() => {
  view.current = open();
});

describe("the wording version (NFR09)", () => {
  it("the about step's form carries the version it shows", async () => {
    const html = await render();
    expect(html).toContain("Step 1 of 4");
    expect(html).toContain(hiddenWording);
  });

  it.each([
    ["club", {}],
    ["scouts", { club: "yes" }],
    ["you", { club: "no" }],
  ])("the %s step without the version shows the about step", async (step, extra) => {
    for (const wording of [undefined, "2000-01"]) {
      const html = await render({ step, ...extra, ...(wording && { wording }) });
      expect(html).toContain("Step 1 of 4");
      expect(html).not.toContain("Who is answering?");
    }
  });

  it.each([
    ["club", {}, "Step 2 of 4"],
    ["scouts", { club: "yes" }, "Step 3 of 4"],
    ["you", { club: "yes", scouts: "no" }, "Step 4 of 4"],
  ])("the %s step carries the version on", async (step, extra, caption) => {
    const html = await render({ step, ...extra, wording: CONSENT_WORDING_VERSION });
    expect(html).toContain(caption);
    expect(html).toContain(hiddenWording);
  });

  it("Change my answer starts again at the about step", async () => {
    view.current = open({
      state: "club_only",
      lastDecision: { clubStats: true, scoutVisible: false, at: new Date("2026-10-20") },
    });
    const html = await render();
    expect(html).toContain('href="/consent/tok?step=about"');
  });
});

describe("errors on the you step", () => {
  const you = (error: string) =>
    render({ step: "you", club: "yes", scouts: "no", wording: CONSENT_WORDING_VERSION, error });

  it("describes the relationship fieldset by the error", async () => {
    const html = await you("relationship");
    expect(html).toMatch(
      /<fieldset class="flex flex-col gap-3" aria-describedby="guardian-error">/,
    );
    expect(html).toContain('id="guardian-error"');
  });

  it("marks the confirm checkbox invalid and describes it by the error", async () => {
    const html = await you("confirm");
    expect(html).toContain(
      '<input type="checkbox" required="" aria-invalid="true" aria-describedby="guardian-error" name="confirm"/>',
    );
  });

  it("leaves both alone without an error", async () => {
    const html = await render({
      step: "you",
      club: "yes",
      scouts: "no",
      wording: CONSENT_WORDING_VERSION,
    });
    expect(html).not.toContain("aria-describedby");
    expect(html).toContain('<input type="checkbox" required="" name="confirm"/>');
  });
});

describe("closed views", () => {
  it("has its own copy for an organisation that cannot take answers", async () => {
    view.current = open({ mode: "closed", reason: "inactive" });
    const html = await render();
    expect(html).toContain("This link no longer works");
    expect(html).toContain(
      "Wideline Demo FC cannot take answers on Wideline right now. If you have questions, ask Wideline Demo FC.",
    );
    expect(html).not.toContain("turned off this link");
  });
});
