import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth } from "@/server/auth/auth";
import { IMPERSONATION_SECONDS } from "@/server/auth/impersonation";
import { contextForSession } from "@/server/auth/session";
import { rawDb } from "@/server/db/raw";
import { fixtures } from "./helpers/fixtures";

// "Log in as" (src/server/auth/impersonation.ts): a platform admin opens a
// session as another user and returns to their own. Driven through the Better
// Auth endpoints with real signed cookies, as the server actions call them.

const f = fixtures();
const PASSWORD = "impersonation-test-password";

type User = { id: string; name: string; email: string };
let admin: User;
let otherAdmin: User;
let coach: User;
let scout: User;

/** Gives the user a password, so signInEmail can mint a real session cookie. */
async function withPassword(u: User) {
  await rawDb.account.create({
    data: {
      id: randomUUID(),
      accountId: u.id,
      providerId: "credential",
      userId: u.id,
      password: await hashPassword(PASSWORD),
    },
  });
}

/** A cookie jar: Set-Cookie headers in, a Cookie request header out. */
class Jar {
  private cookies = new Map<string, string>();

  take(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === "";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  headers() {
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    return new Headers({ cookie });
  }

  /** The raw session token behind the signed session cookie. */
  sessionToken() {
    const signed = [...this.cookies].find(([k]) => k.endsWith("session_token"))?.[1];
    return signed ? decodeURIComponent(signed).split(".")[0]! : null;
  }

  has(suffix: string) {
    return [...this.cookies.keys()].some((k) => k.endsWith(suffix));
  }
}

async function signIn(u: User): Promise<Jar> {
  const jar = new Jar();
  jar.take(
    await auth().api.signInEmail({
      body: { email: u.email, password: PASSWORD },
      asResponse: true,
    }),
  );
  return jar;
}

async function start(jar: Jar, userId: string) {
  const res = await auth().api.startImpersonation({
    body: { userId },
    headers: jar.headers(),
    asResponse: true,
  });
  jar.take(res);
  return res;
}

async function stop(jar: Jar) {
  const res = await auth().api.stopImpersonation({ headers: jar.headers(), asResponse: true });
  jar.take(res);
  return res;
}

beforeAll(async () => {
  const platform = await f.org("Wideline", { type: "platform" });
  const club = await f.org("Imp FC");
  admin = await f.user("Imp Admin");
  otherAdmin = await f.user("Imp Other Admin");
  coach = await f.user("Imp Coach");
  scout = await f.user("Imp Scout");
  await f.member(platform.id, admin.id, "platform_admin");
  await f.member(platform.id, otherAdmin.id, "platform_admin");
  await f.member(club.id, coach.id, "coach");
  for (const u of [admin, coach]) await withPassword(u);
});

afterAll(async () => {
  await f.cleanup();
});

describe("log in as", () => {
  it("opens an hour-long session as the user and returns the admin to their own", async () => {
    const jar = await signIn(admin);
    const adminToken = jar.sessionToken();
    expect(adminToken).not.toBeNull();

    const before = Date.now();
    const res = await start(jar, coach.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ userId: coach.id });
    expect(jar.has("impersonator_session")).toBe(true);

    const token = jar.sessionToken()!;
    expect(token).not.toBe(adminToken);
    const row = await rawDb.session.findUniqueOrThrow({ where: { token } });
    expect(row).toMatchObject({ userId: coach.id, impersonatedBy: admin.id });
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + IMPERSONATION_SECONDS * 1000,
    );
    expect(row.expiresAt.getTime()).toBeGreaterThan(before);

    // Requests now resolve to the coach, with the admin named as impersonator.
    const session = await auth().api.getSession({ headers: jar.headers() });
    expect(session?.user.id).toBe(coach.id);
    const ctx = await contextForSession({
      sessionId: session!.session.id,
      user: session!.user,
      activeOrganisationId: null,
      impersonatedBy: session!.session.impersonatedBy,
    });
    expect(ctx.impersonator?.id).toBe(admin.id);
    expect(ctx.roles).toEqual(["coach"]);

    expect(
      await rawDb.auditLog.count({
        where: { action: "auth.impersonate.start", actorUserId: admin.id, targetId: row.id },
      }),
    ).toBe(1);

    const back = await stop(jar);
    expect(await back.json()).toEqual({ restored: true });
    expect(jar.sessionToken()).toBe(adminToken);
    expect(jar.has("impersonator_session")).toBe(false);
    expect(await rawDb.session.findUnique({ where: { token } })).toBeNull();
    expect((await auth().api.getSession({ headers: jar.headers() }))?.user.id).toBe(admin.id);
    expect(
      await rawDb.auditLog.count({
        where: { action: "auth.impersonate.stop", actorUserId: admin.id, targetId: coach.id },
      }),
    ).toBe(1);
  });

  it("works for a user with no organisation, such as a scout awaiting approval", async () => {
    const jar = await signIn(admin);
    await start(jar, scout.id);
    expect((await auth().api.getSession({ headers: jar.headers() }))?.user.id).toBe(scout.id);
    await stop(jar);
  });

  it("refuses anyone who is not a platform admin", async () => {
    const jar = await signIn(coach);
    expect((await start(jar, scout.id)).status).toBe(403);
  });

  it("refuses another platform admin, the admin themselves and an unknown user", async () => {
    const jar = await signIn(admin);
    expect((await start(jar, otherAdmin.id)).status).toBe(403);
    expect((await start(jar, admin.id)).status).toBe(400);
    expect((await start(jar, randomUUID())).status).toBe(404);
    expect(jar.has("impersonator_session")).toBe(false);
  });

  it("refuses to start another one from inside an impersonation session", async () => {
    const jar = await signIn(admin);
    await start(jar, coach.id);
    expect((await start(jar, scout.id)).status).toBe(400);
    expect((await stop(jar)).status).toBe(200);
  });

  it("refuses to stop a session that is not an impersonation", async () => {
    const jar = await signIn(admin);
    expect((await stop(jar)).status).toBe(400);
  });

  it("signs out when the admin's own session ended meanwhile", async () => {
    const jar = await signIn(admin);
    const adminToken = jar.sessionToken()!;
    await start(jar, coach.id);
    await rawDb.session.delete({ where: { token: adminToken } });

    const back = await stop(jar);
    expect(await back.json()).toEqual({ restored: false });
    expect(await auth().api.getSession({ headers: jar.headers() })).toBeNull();
  });
});
