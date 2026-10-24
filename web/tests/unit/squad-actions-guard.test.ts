import { beforeEach, describe, expect, it, vi } from "vitest";

// C04 (AUTH06): every squad action checks SQUAD_ADMIN_ROLES before it reads the
// form, so a coach (CLUB_ROLES only) gets 403 and nothing runs. The import
// actions show the 403 as a form error, as the design asks.

const requireRole = vi.fn();
vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  requireRole,
}));

const touched = vi.fn();
const service = <T extends object>(mod: T) =>
  Object.fromEntries(
    Object.entries(mod).map(([k, v]) => [
      k,
      typeof v === "function" && /^[a-z]/.test(k)
        ? (...args: unknown[]) => {
            touched(k);
            return (v as (...a: unknown[]) => unknown)(...args);
          }
        : v,
    ]),
  );
vi.mock("@/server/squad/teams", async (o) => service(await o<object>()));
vi.mock("@/server/squad/players", async (o) => service(await o<object>()));
vi.mock("@/server/squad/import", async (o) => service(await o<object>()));

const { AuthzError, SQUAD_ADMIN_ROLES } =
  await vi.importActual<typeof import("@/server/auth/session")>("@/server/auth/session");
const teams = await import("@/app/(app)/squad/teams/actions");
const players = await import("@/app/(app)/squad/players/actions");
const importActions = await import("@/app/(app)/squad/import/actions");

beforeEach(() => {
  requireRole.mockReset();
  touched.mockReset();
  requireRole.mockImplementation(async () => {
    throw new AuthzError(403, "Requires one of: owner, admin");
  });
});

const form = () => {
  const fd = new FormData();
  fd.set("teamId", "t-1");
  fd.set("playerId", "p-1");
  fd.set("name", "U15 Boys");
  fd.set("season", "2026");
  fd.set("numbers", "1-11");
  return fd;
};

describe("squad actions for a coach", () => {
  it.each([
    ["createTeamAction", teams.createTeamAction],
    ["updateTeamAction", teams.updateTeamAction],
    ["deleteTeamAction", teams.deleteTeamAction],
    ["addPlaceholdersAction", teams.addPlaceholdersAction],
    ["createPlayerAction", players.createPlayerAction],
    ["updatePlayerAction", players.updatePlayerAction],
    ["markDepartedAction", players.markDepartedAction],
    ["undoDepartureAction", players.undoDepartureAction],
  ])("%s refuses with 403 before touching the squad", async (_name, action) => {
    const err = await action(null, form()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthzError);
    expect((err as InstanceType<typeof AuthzError>).status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith(SQUAD_ADMIN_ROLES);
    expect(touched).not.toHaveBeenCalled();
  });

  it.each([
    ["previewImportAction", importActions.previewImportAction],
    ["commitImportAction", importActions.commitImportAction],
  ])("%s answers with the permission error and imports nothing", async (_name, action) => {
    const res = await action(null, form());
    expect(res).toEqual({
      step: "upload",
      result: { ok: false, formError: "You do not have permission to import players." },
    });
    expect(requireRole).toHaveBeenCalledWith(SQUAD_ADMIN_ROLES);
    expect(touched).not.toHaveBeenCalled();
  });
});

describe("squad actions in an organisation that is not an academy or a club", () => {
  beforeEach(() => {
    requireRole.mockImplementation(async () => ({
      organisationId: "agency-1",
      organisationType: "agency",
      roles: ["owner"],
    }));
  });

  it.each([
    ["createTeamAction", teams.createTeamAction],
    ["updateTeamAction", teams.updateTeamAction],
    ["deleteTeamAction", teams.deleteTeamAction],
    ["addPlaceholdersAction", teams.addPlaceholdersAction],
    ["createPlayerAction", players.createPlayerAction],
    ["updatePlayerAction", players.updatePlayerAction],
    ["markDepartedAction", players.markDepartedAction],
    ["undoDepartureAction", players.undoDepartureAction],
  ])("%s refuses an agency owner with 403 before touching the squad", async (_name, action) => {
    const err = await action(null, form()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthzError);
    expect((err as InstanceType<typeof AuthzError>).status).toBe(403);
    expect(touched).not.toHaveBeenCalled();
  });

  it.each([
    ["previewImportAction", importActions.previewImportAction],
    ["commitImportAction", importActions.commitImportAction],
  ])("%s answers an agency owner with the permission error", async (_name, action) => {
    const res = await action(null, form());
    expect(res).toEqual({
      step: "upload",
      result: { ok: false, formError: "You do not have permission to import players." },
    });
    expect(touched).not.toHaveBeenCalled();
  });
});
