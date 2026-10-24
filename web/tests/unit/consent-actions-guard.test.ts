import { beforeEach, describe, expect, it, vi } from "vitest";

// C05 (AUTH06): every club consent action checks CONSENT_ADMIN_ROLES before it
// reads the form, so a coach (CLUB_ROLES only) gets 403 and no consent service
// runs. Recording and withdrawing consent stay with owners and admins.

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
vi.mock("@/server/consent/records", async (o) => service(await o<object>()));
vi.mock("@/server/consent/requests", async (o) => service(await o<object>()));

const { AuthzError, CONSENT_ADMIN_ROLES } =
  await vi.importActual<typeof import("@/server/auth/session")>("@/server/auth/session");
const actions = await import("@/app/(app)/squad/players/[playerId]/consent/actions");

const form = () => {
  const fd = new FormData();
  fd.set("playerId", "p-1");
  fd.set("grantedBy", "Thandi");
  fd.set("requestedBy", "Thandi");
  return fd;
};

const ALL = [
  ["recordConsentAction", actions.recordConsentAction],
  ["withdrawConsentAction", actions.withdrawConsentAction],
  ["requestConsentAction", actions.requestConsentAction],
  ["revokeConsentRequestAction", actions.revokeConsentRequestAction],
] as const;

beforeEach(() => {
  requireRole.mockReset();
  touched.mockReset();
});

describe("consent actions for a coach", () => {
  it.each(ALL)("%s refuses with 403 before touching consent", async (_name, action) => {
    requireRole.mockImplementation(async () => {
      throw new AuthzError(403, "Requires one of: owner, admin");
    });
    const err = await action(null, form()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthzError);
    expect((err as InstanceType<typeof AuthzError>).status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith(CONSENT_ADMIN_ROLES);
    expect(touched).not.toHaveBeenCalled();
  });
});

describe("consent actions in an organisation that is not an academy or a club", () => {
  it.each(ALL)("%s refuses an agency owner with 403", async (_name, action) => {
    requireRole.mockImplementation(async () => ({
      organisationId: "agency-1",
      organisationType: "agency",
      roles: ["owner"],
    }));
    const err = await action(null, form()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthzError);
    expect(touched).not.toHaveBeenCalled();
  });
});
