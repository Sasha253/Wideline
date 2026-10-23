import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// C01 acceptance (AUTH06): every server action calls requireRole(),
// requirePageRole() or withRole() before it does anything. The only
// exceptions are public actions whose capability is a token or a public form.

const PUBLIC_ACTIONS = new Set([
  // The invitation token is the capability; acceptInvitation re-checks it.
  "acceptInvitationAction",
  // The public "Join the pilot" form, with a honeypot.
  "applyForOrganisation",
]);

const appDir = join(import.meta.dirname, "../../src/app");
const actionFiles = readdirSync(appDir, { recursive: true, encoding: "utf8" })
  .filter((f) => /(^|\/)actions\.ts$/.test(f))
  .map((f) => join(appDir, f));

/** Exported async functions and their bodies, split at each export. */
function exportedActions(src: string): { name: string; body: string }[] {
  const re = /export\s+async\s+function\s+(\w+)/g;
  const starts = [...src.matchAll(re)];
  return starts.map((m, i) => ({
    name: m[1]!,
    body: src.slice(m.index, starts[i + 1]?.index ?? src.length),
  }));
}

describe("server actions", () => {
  it("finds the C01 action files", () => {
    expect(actionFiles.length).toBeGreaterThanOrEqual(6);
  });

  it.each(actionFiles)("%s starts with 'use server'", (file) => {
    expect(readFileSync(file, "utf8").trimStart().startsWith('"use server"')).toBe(true);
  });

  it.each(actionFiles)("every action in %s is guarded", (file) => {
    const src = readFileSync(file, "utf8");
    // A server-action file may only export async functions and types.
    expect(src).not.toMatch(/export\s+(const|let|var|function\s)/);
    for (const { name, body } of exportedActions(src)) {
      if (PUBLIC_ACTIONS.has(name)) continue;
      expect(body, `${name} must call requireRole`).toMatch(
        /\b(requireRole|requirePageRole|withRole)\(/,
      );
    }
  });

  it("keeps the public allowlist to actions that exist", () => {
    const names = actionFiles
      .flatMap((f) => exportedActions(readFileSync(f, "utf8")))
      .map((a) => a.name);
    for (const name of PUBLIC_ACTIONS) expect(names).toContain(name);
  });
});
