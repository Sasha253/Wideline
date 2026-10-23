import { randomUUID } from "node:crypto";
import type { OrganisationStatus, OrganisationType, Role } from "@/generated/prisma/enums";
import { rawDb } from "@/server/db/raw";
import { contextForSession, type AuthContext } from "@/server/auth/session";

// Shared fixtures for the C01 integration tests. Every row carries a random tag
// in its name or email, and cleanup() deletes what one test file created.

export function fixtures() {
  const tag = randomUUID().slice(0, 8);
  const orgIds: string[] = [];
  const userIds: string[] = [];

  async function org(
    name: string,
    {
      status = "active",
      type = "club",
    }: { status?: OrganisationStatus; type?: OrganisationType } = {},
  ) {
    const o = await rawDb.organisation.create({
      data: { name: `${name} ${tag}`, type, status },
    });
    orgIds.push(o.id);
    return o;
  }

  async function user(name: string) {
    const u = await rawDb.user.create({
      data: {
        id: randomUUID(),
        email: `${name.toLowerCase().replace(/\W+/g, "-")}-${tag}@test.local`,
        name,
        emailVerified: true,
      },
    });
    userIds.push(u.id);
    return u;
  }

  async function member(organisationId: string, userId: string, role: Role, createdAt?: Date) {
    return rawDb.membership.create({
      data: {
        organisationId,
        userId,
        role,
        acceptedAt: new Date(),
        ...(createdAt && { createdAt }),
      },
    });
  }

  async function session(userId: string) {
    return rawDb.session.create({
      data: {
        id: randomUUID(),
        token: randomUUID(),
        userId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
  }

  /** The context a request from this session would get. */
  async function ctx(
    u: { id: string; name: string; email: string },
    activeOrganisationId: string | null = null,
    sessionId = "test-session",
  ): Promise<AuthContext> {
    const c = await contextForSession({
      sessionId,
      user: { id: u.id, name: u.name, email: u.email },
      activeOrganisationId,
    });
    if (!c.organisationId) throw new Error("fixture user has no active organisation");
    return c;
  }

  /** Tracks a user created by the code under test, so cleanup() deletes it. */
  async function trackUserByEmail(email: string) {
    const u = await rawDb.user.findUnique({ where: { email } });
    if (u) userIds.push(u.id);
  }

  async function cleanup() {
    // Applications create organisations by name; catch those too.
    await rawDb.organisation.deleteMany({
      where: { OR: [{ id: { in: orgIds } }, { name: { contains: tag } }] },
    });
    await rawDb.user.deleteMany({
      where: { OR: [{ id: { in: userIds } }, { email: { contains: tag } }] },
    });
    await rawDb.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  }

  return { tag, org, user, member, session, ctx, trackUserByEmail, cleanup };
}
