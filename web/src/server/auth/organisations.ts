import "server-only";
import { rawDb } from "../db/raw";
import { AuthzError } from "./session";

/**
 * Makes organisationId the active organisation of one session (AUTH-05). The
 * user must hold an accepted membership there, and the organisation must be
 * active; otherwise AuthzError 403. Only the session with this id and user is
 * changed, so one user's switch never touches another user's session.
 */
export async function setActiveOrganisation(
  sessionId: string,
  userId: string,
  organisationId: string,
): Promise<void> {
  const membership = await rawDb.membership.findFirst({
    where: {
      userId,
      organisationId,
      acceptedAt: { not: null },
      organisation: { status: "active" },
    },
    select: { id: true },
  });
  if (!membership) throw new AuthzError(403, "Not a member of that organisation");

  const { count } = await rawDb.session.updateMany({
    where: { id: sessionId, userId },
    data: { activeOrganisationId: organisationId },
  });
  if (count !== 1) throw new AuthzError(401, "Session not found");
}
