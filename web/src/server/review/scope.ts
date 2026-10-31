import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { isClaimLive } from "@/lib/review-rules";
import type { ReviewerContext } from "../auth/reviewer";
import { consentVisibleTo } from "../consent/visibility";
import { rawDb } from "../db/raw";
import { scopedDb, TenantScopeError } from "../db/scoped";

/**
 * The claim scope (NFR16: review data is scoped to the claiming scout's review
 * claim, by construction). Every review read in C11 goes through
 * claimScope(): never rawDb, and never the scout's own ctx.db (that is the
 * scout network's tenant). It hands out a client only while the caller holds
 * the live claim, and it is checked again on every request and action, so
 * access ends on the next request after an expiry, a release, a suspension
 * (requireReviewer fails first) or a submit.
 *
 * The client (ClaimDb) enforces the claim itself, on top of the match
 * organisation's scopedDb:
 *  - only the match-bound models below, and only their read operations; no
 *    writes, no raw SQL, no Consent, ConsentRequest, Team, Membership, User,
 *    Organisation, AuditLog or any other model (they are not on the object,
 *    and the extension refuses them at run time too);
 *  - every query is narrowed to the claim: Match to claim.matchId, Video to
 *    claim.videoId, Lineup, Event, Track, TrackPoint and Clip to
 *    claim.matchId, and Player to the claimed match's lineup players the
 *    reviewer may see by name (consentVisibleTo({ kind: "reviewer" }), Q-021);
 *  - scalar fields only: no include, no relation in select, where, orderBy,
 *    cursor or an aggregate, so no query can walk from the claimed match to
 *    another match or to a club_only player's name.
 * C11 adds the review writes (corrections, relinks, submit) as functions in
 * src/server/review/, each taking a ClaimScope; it never widens this client.
 */

export type ClaimScope = {
  claim: {
    id: string;
    organisationId: string;
    matchId: string;
    videoId: string;
    claimedAt: Date;
    expiresAt: Date;
  };
  db: ClaimDb;
};

type Claim = ClaimScope["claim"];

/** The models a reviewer may read, with their scalar fields (generated, so they track the schema). */
const CLAIM_MODELS = {
  Match: Prisma.MatchScalarFieldEnum,
  Video: Prisma.VideoScalarFieldEnum,
  Lineup: Prisma.LineupScalarFieldEnum,
  Event: Prisma.EventScalarFieldEnum,
  Track: Prisma.TrackScalarFieldEnum,
  TrackPoint: Prisma.TrackPointScalarFieldEnum,
  Clip: Prisma.ClipScalarFieldEnum,
  Player: Prisma.PlayerScalarFieldEnum,
} as const satisfies Partial<Record<Prisma.ModelName, Record<string, string>>>;

type ClaimModel = keyof typeof CLAIM_MODELS;

const SCALARS: Record<ClaimModel, ReadonlySet<string>> = Object.fromEntries(
  Object.entries(CLAIM_MODELS).map(([m, fields]) => [m, new Set<string>(Object.values(fields))]),
) as Record<string, ReadonlySet<string>>;

const READ_OPS = [
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
] as const;
type ReadOp = (typeof READ_OPS)[number];
const READ_OP_SET = new Set<string>(READ_OPS);

const LOGICAL = new Set(["AND", "OR", "NOT"]);
const AGGREGATES = new Set(["_count", "_sum", "_avg", "_min", "_max"]);
/** Arguments a read may take. include, relationLoadStrategy and the rest are refused. */
const ARG_KEYS = new Set([
  "where",
  "select",
  "omit",
  "orderBy",
  "take",
  "skip",
  "cursor",
  "distinct",
  "by",
  "having",
  ...AGGREGATES,
]);

function refuse(model: string, message: string): never {
  throw new TenantScopeError(`${model} (claim scope): ${message}`);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

/** where and having: logical operators and scalar fields only. A scalar's filter is not walked. */
function checkWhere(model: ClaimModel, where: unknown, path: string): void {
  if (where === undefined) return;
  if (Array.isArray(where)) {
    where.forEach((w, i) => checkWhere(model, w, `${path}[${i}]`));
    return;
  }
  if (!isObject(where)) refuse(model, `${path} must be an object`);
  for (const [key, value] of Object.entries(where)) {
    if (LOGICAL.has(key)) checkWhere(model, value, `${path}.${key}`);
    else if (!SCALARS[model].has(key)) refuse(model, `${path}.${key} is not a scalar field`);
  }
}

/** select, omit, cursor and an aggregate's fields: scalar keys only (_all for counts). */
function checkFields(model: ClaimModel, value: unknown, path: string, allowAll = false): void {
  if (value === undefined || value === true) return;
  if (!isObject(value)) refuse(model, `${path} must be an object`);
  for (const key of Object.keys(value)) {
    if (allowAll && key === "_all") continue;
    if (!SCALARS[model].has(key)) refuse(model, `${path}.${key} is not a scalar field`);
  }
}

function checkOrderBy(model: ClaimModel, orderBy: unknown, path: string): void {
  if (orderBy === undefined) return;
  if (Array.isArray(orderBy)) {
    orderBy.forEach((o, i) => checkOrderBy(model, o, `${path}[${i}]`));
    return;
  }
  if (!isObject(orderBy)) refuse(model, `${path} must be an object`);
  for (const [key, value] of Object.entries(orderBy)) {
    if (AGGREGATES.has(key)) checkFields(model, value, `${path}.${key}`);
    else if (!SCALARS[model].has(key)) refuse(model, `${path}.${key} is not a scalar field`);
  }
}

function checkNames(model: ClaimModel, value: unknown, path: string): void {
  if (value === undefined) return;
  for (const name of Array.isArray(value) ? value : [value]) {
    if (typeof name !== "string" || !SCALARS[model].has(name)) {
      refuse(model, `${path} names a field that is not a scalar`);
    }
  }
}

/** Throws unless every argument stays on this model's scalar fields. */
function checkArgs(model: ClaimModel, operation: string, args: Record<string, unknown>): void {
  for (const key of Object.keys(args)) {
    if (!ARG_KEYS.has(key)) refuse(model, `${key} is not allowed; select scalar fields only`);
  }
  checkWhere(model, args.where, "where");
  checkWhere(model, args.having, "having");
  checkFields(model, args.select, "select", operation === "count");
  checkFields(model, args.omit, "omit");
  checkFields(model, args.cursor, "cursor");
  checkOrderBy(model, args.orderBy, "orderBy");
  checkNames(model, args.distinct, "distinct");
  checkNames(model, args.by, "by");
  for (const agg of AGGREGATES) checkFields(model, args[agg], agg, agg === "_count");
}

/** The claim's own rows of each model. Player: the match's lineup, by name only with consent. */
function claimWhere(model: ClaimModel, claim: Claim): Record<string, unknown> {
  switch (model) {
    case "Match":
      return { id: claim.matchId };
    case "Video":
      return { id: claim.videoId, matchId: claim.matchId };
    case "Player":
      return {
        ...consentVisibleTo({ kind: "reviewer" }),
        lineups: { some: { matchId: claim.matchId } },
      };
    default:
      return { matchId: claim.matchId };
  }
}

const andWhere = (where: unknown, scope: object): object =>
  isObject(where) && Object.keys(where).length > 0 ? { AND: [where, scope] } : scope;

function claimClient(claim: Claim) {
  return scopedDb(claim.organisationId).$extends({
    name: "claim-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!(model in CLAIM_MODELS)) refuse(model, "not readable in a review");
          const m = model as ClaimModel;
          if (!READ_OP_SET.has(operation)) refuse(m, `${operation} is not allowed; reads only`);
          const a = { ...(args as Record<string, unknown>) };
          checkArgs(m, operation, a);
          a.where = andWhere(a.where, claimWhere(m, claim));
          return query(a);
        },
      },
    },
  });
}

type ClaimClient = ReturnType<typeof claimClient>;

/** Read-only, claim-bound delegates: the only review data a reviewer path can reach. */
export type ClaimDb = {
  match: Pick<ClaimClient["match"], ReadOp>;
  video: Pick<ClaimClient["video"], ReadOp>;
  lineup: Pick<ClaimClient["lineup"], ReadOp>;
  event: Pick<ClaimClient["event"], ReadOp>;
  track: Pick<ClaimClient["track"], ReadOp>;
  trackPoint: Pick<ClaimClient["trackPoint"], ReadOp>;
  clip: Pick<ClaimClient["clip"], ReadOp>;
  player: Pick<ClaimClient["player"], ReadOp>;
};

function claimDb(claim: Claim): ClaimDb {
  const c = claimClient(claim);
  return {
    match: c.match,
    video: c.video,
    lineup: c.lineup,
    event: c.event,
    track: c.track,
    trackPoint: c.trackPoint,
    clip: c.clip,
    player: c.player,
  };
}

export async function claimScope(
  ctx: ReviewerContext,
  claimId: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<ClaimScope | null> {
  const row = await rawDb.reviewClaim.findUnique({
    where: { id: claimId },
    select: {
      id: true,
      organisationId: true,
      matchId: true,
      videoId: true,
      scoutUserId: true,
      status: true,
      claimedAt: true,
      expiresAt: true,
    },
  });
  if (!row || row.scoutUserId !== ctx.user.id || !isClaimLive(row, now)) return null;
  const claim: Claim = {
    id: row.id,
    organisationId: row.organisationId,
    matchId: row.matchId,
    videoId: row.videoId,
    claimedAt: row.claimedAt,
    expiresAt: row.expiresAt,
  };
  return { claim, db: claimDb(claim) };
}
