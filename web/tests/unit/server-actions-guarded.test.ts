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
  // Public scout registration (C02): a new account, or the signed-in user registering
  // themselves; never another user. A honeypot catches simple bots.
  "registerScoutAction",
  // Guardian consent links (C05): the token is the capability; guardianDecide and
  // guardianWithdraw re-check the link on every call.
  "guardianDecisionAction",
  "guardianWithdrawAction",
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
        /\b(requireRole|requirePageRole|withRole|requireReviewer)\(/,
      );
    }
  });

  it("finds and guards the C02 scout and admin action files", () => {
    const rel = actionFiles.map((f) => f.slice(appDir.length + 1));
    expect(rel).toContain("(app)/scout/actions.ts");
    expect(rel).toContain("(app)/admin/scouts/actions.ts");
    expect(rel).toContain("register/actions.ts");
    for (const file of actionFiles.filter((f) => /\/(scout|admin\/scouts)\/actions\.ts$/.test(f))) {
      for (const { name } of exportedActions(readFileSync(file, "utf8"))) {
        expect(PUBLIC_ACTIONS.has(name), name).toBe(false);
      }
    }
  });

  it("finds and guards the C03 flags and limits action file, none of it public", () => {
    const file = actionFiles.find((f) =>
      f.endsWith("(app)/admin/organisations/[organisationId]/actions.ts"),
    );
    expect(file).toBeDefined();
    const names = exportedActions(readFileSync(file!, "utf8")).map((a) => a.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "setFeatureFlagAction",
        "setLimitOverrideAction",
        "clearLimitOverrideAction",
      ]),
    );
    for (const name of names) expect(PUBLIC_ACTIONS.has(name), name).toBe(false);
  });

  it("finds and guards the C04 squad action files, none of it public", () => {
    const rel = actionFiles.map((f) => f.slice(appDir.length + 1));
    for (const file of [
      "(app)/squad/teams/actions.ts",
      "(app)/squad/players/actions.ts",
      "(app)/squad/import/actions.ts",
    ]) {
      expect(rel).toContain(file);
      const src = readFileSync(join(appDir, file), "utf8");
      for (const { name, body } of exportedActions(src)) {
        expect(PUBLIC_ACTIONS.has(name), name).toBe(false);
        expect(body, `${name} must write with SQUAD_ADMIN_ROLES`).toMatch(
          /requireRole\(SQUAD_ADMIN_ROLES\)/,
        );
      }
    }
  });

  it("finds the C05 consent action files: club actions need CONSENT_ADMIN_ROLES", () => {
    const rel = actionFiles.map((f) => f.slice(appDir.length + 1));
    const club = "(app)/squad/players/[playerId]/consent/actions.ts";
    expect(rel).toContain(club);
    expect(rel).toContain("consent/[token]/actions.ts");
    const actions = exportedActions(readFileSync(join(appDir, club), "utf8"));
    expect(actions.map((a) => a.name)).toEqual(
      expect.arrayContaining([
        "recordConsentAction",
        "withdrawConsentAction",
        "requestConsentAction",
        "revokeConsentRequestAction",
      ]),
    );
    for (const { name, body } of actions) {
      expect(PUBLIC_ACTIONS.has(name), name).toBe(false);
      expect(body, `${name} must write with CONSENT_ADMIN_ROLES`).toMatch(
        /requireRole\(CONSENT_ADMIN_ROLES\)/,
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
