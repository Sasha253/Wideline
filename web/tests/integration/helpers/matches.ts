import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import type { AuthContext } from "@/server/auth/session";
import { rawDb } from "@/server/db/raw";
import { createMatch } from "@/server/matches/matches";
import { bucket, s3Internal } from "@/server/storage";
import { createPlayer } from "@/server/squad/players";
import { createTeam } from "@/server/squad/teams";
import { dobYearsAgo } from "./consent";
import type { fixtures } from "./fixtures";

// Match fixtures for the C06 integration tests: a club with an owner and a
// coach, an own team with named players, an opposition team with placeholders,
// and a match between them.

export const FIXTURES_DIR = join(import.meta.dirname, "../../fixtures");
export const FOOTAGE_1080P = join(FIXTURES_DIR, "footage-1080p.mp4");
export const FOOTAGE_720P = join(FIXTURES_DIR, "footage-720p.mp4");

/** True when object storage answers (the compose stack's RustFS). CI has none. */
export async function storageAvailable(): Promise<boolean> {
  try {
    await s3Internal().send(new HeadBucketCommand({ Bucket: bucket() }));
    return true;
  } catch {
    return false;
  }
}

/** True when ffprobe is on the PATH and the generated footage exists (`make fixtures`). */
export function ffprobeAvailable(): boolean {
  try {
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return existsSync(FOOTAGE_1080P) && existsSync(FOOTAGE_720P);
  } catch {
    return false;
  }
}

let n = 0;

export async function setupClub(f: ReturnType<typeof fixtures>, name: string) {
  const org = await f.org(name);
  const owner = await f.user(`${name} Owner`);
  const coach = await f.user(`${name} Coach`);
  await f.member(org.id, owner.id, "owner");
  await f.member(org.id, coach.id, "coach");
  const ctx = await f.ctx(owner, org.id);
  const coachCtx = await f.ctx(coach, org.id);
  const own = await createTeam(ctx, { name: "U15 Boys", season: "2026" });
  const other = await createTeam(ctx, { name: "U16 Boys", season: "2026" });
  const opposition = await createTeam(ctx, { name: "Rivals U15", season: "2026" }, "opposition");
  return { org, owner, coach, ctx, coachCtx, own, other, opposition };
}

/** A named player on a team, with a squad number. */
export async function player(ctx: AuthContext, teamId: string, squadNumber?: number) {
  n += 1;
  return createPlayer(ctx, {
    firstName: "Thabo",
    lastName: `Nkosi${n}`,
    dateOfBirth: dobYearsAgo(14, 10),
    teamId,
    squadNumber: squadNumber === undefined ? "" : String(squadNumber),
  });
}

export async function match(
  ctx: AuthContext,
  homeTeamId: string,
  awayTeamId: string,
  extra: { halfLengthMinutes?: number } = {},
) {
  return createMatch(ctx, {
    homeTeamId,
    awayTeamId,
    playedAt: "2026-10-18",
    venue: "Dobsonville Stadium",
    competition: "",
    halfLengthMinutes: extra.halfLengthMinutes ?? 45,
  });
}

/** pg-boss jobs on a queue whose payload has this value under `key`. */
export async function jobsFor(queue: string, key: string, value: string): Promise<number> {
  const rows = await rawDb.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM pgboss.job WHERE name = $1 AND data->>$2 = $3`,
    queue,
    key,
    value,
  );
  return Number(rows[0]?.n ?? 0);
}
