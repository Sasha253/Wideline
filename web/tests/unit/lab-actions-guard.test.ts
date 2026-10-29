import { beforeEach, describe, expect, it, vi } from "vitest";

// C09 (AUTH06): the Lab's match actions check LAB_ROLES (platform admins) before
// they read the form, so a club owner gets 403 and no tag import, calibration
// save or cache revalidation runs.

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
vi.mock("@/server/lab/tags", async (o) => service(await o<object>()));
vi.mock("@/server/cv/calibration", async (o) => service(await o<object>()));
vi.mock("next/cache", async (o) => service(await o<object>()));
vi.mock("next/navigation", async (o) => service(await o<object>()));

const { AuthzError, LAB_ROLES } =
  await vi.importActual<typeof import("@/server/auth/session")>("@/server/auth/session");
const actions = await import("@/app/(app)/lab/matches/[matchId]/actions");

beforeEach(() => {
  requireRole.mockReset();
  touched.mockReset();
  requireRole.mockImplementation(async () => {
    throw new AuthzError(403, "Requires one of: platform_admin");
  });
});

const form = () => {
  const fd = new FormData();
  fd.set("matchId", "m-1");
  fd.set("source", "hand");
  fd.set("csv", "type,time,teamSide,onTarget\ngoal,12:04.2,home,\n");
  fd.set("expectedCurrentId", "");
  fd.set(
    "points",
    JSON.stringify([
      { landmark: "corner_near_left", x: 10, y: 10 },
      { landmark: "corner_near_right", x: 100, y: 10 },
      { landmark: "corner_far_left", x: 10, y: 100 },
      { landmark: "corner_far_right", x: 100, y: 100 },
    ]),
  );
  return fd;
};

describe("lab match actions for someone who is not a platform admin", () => {
  it.each([
    ["importTagsAction", actions.importTagsAction],
    ["saveCalibrationAction", actions.saveCalibrationAction],
  ])("%s refuses with 403 and does no work", async (_name, action) => {
    const err = await action(null, form()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthzError);
    expect((err as InstanceType<typeof AuthzError>).status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith(LAB_ROLES);
    expect(touched).not.toHaveBeenCalled();
  });
});
