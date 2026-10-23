import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The gallery is for Wideline staff only (AUTH06): the page must call
// requirePageRole with DEV_ROLES before it renders anything.
const requirePageRole = vi.fn();
vi.mock("@/server/auth/session", () => ({
  DEV_ROLES: ["platform_admin"],
  requirePageRole,
}));

const { default: ComponentsPage } = await import("@/app/dev/components/page");

describe("/dev/components access", () => {
  // Braces matter: a function returned from beforeEach runs as teardown.
  beforeEach(() => {
    requirePageRole.mockReset();
  });

  it("checks the platform_admin role before rendering", async () => {
    requirePageRole.mockImplementation(async () => {
      throw new Error("NEXT_REDIRECT");
    });
    await expect(ComponentsPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(requirePageRole).toHaveBeenCalledWith(["platform_admin"]);
  });

  it("renders both themed bands for a platform admin", async () => {
    requirePageRole.mockResolvedValue({});
    const out = renderToStaticMarkup(await ComponentsPage());
    expect(out).toContain("<h1");
    expect(out).toContain('data-gallery-theme="light"');
    expect(out).toContain('data-gallery-theme="dark"');
    expect(out.match(/data-component="/g)).toHaveLength(24);
  });
});

describe("DEV_ROLES", () => {
  it("is platform_admin only", async () => {
    const actual =
      await vi.importActual<typeof import("@/server/auth/session")>("@/server/auth/session");
    expect(actual.DEV_ROLES).toEqual(["platform_admin"]);
  });
});
