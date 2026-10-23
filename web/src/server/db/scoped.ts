import { Prisma } from "@/generated/prisma/client";
import { rawDb } from "./raw";

/**
 * Tenant scoping by construction (NFR-16).
 *
 * scopedDb(organisationId) returns a Prisma client that:
 *  - injects organisationId into the where clause of every read, update and
 *    delete on a tenant-scoped model, and into the data of every create;
 *  - refuses to move a row to another organisation or to name another
 *    organisation anywhere in a write, including nested writes;
 *  - exposes global models only in a narrowed form (User: read-only and only
 *    members of this organisation; Organisation: only this one);
 *  - refuses the Better Auth tables entirely.
 *
 * Cross-tenant foreign keys are blocked in the database too: references between
 * tenant tables are composite (organisationId, id) foreign keys, so a row can
 * only point at rows of its own organisation.
 *
 * Raw SQL ($queryRaw, $executeRaw) is not scoped. Do not use it from a scoped
 * client; put raw SQL in src/server/db/ and filter by organisationId by hand.
 */

// Models with an organisationId column. Keep in step with schema.prisma.
export const TENANT_SCOPED = new Set<Prisma.ModelName>([
  "Membership",
  "Team",
  "Player",
  "Match",
  "Lineup",
  "AuditLog",
  "Invitation",
]);

const FORBIDDEN = new Set<Prisma.ModelName>(["Session", "Account", "Verification"]);

const UNIQUE_WHERE_OPS = new Set(["findUnique", "findUniqueOrThrow", "update", "delete", "upsert"]);
const WHERE_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
]);
const READ_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeError";
  }
}

type Args = Record<string, unknown>;

function andWhere(where: unknown, scope: object): object {
  return where && Object.keys(where as object).length > 0 ? { AND: [where, scope] } : scope;
}

/** Throws if a write names any organisation other than this one, at any depth. */
function assertWriteStaysInTenant(value: unknown, organisationId: string, path = "data"): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertWriteStaysInTenant(v, organisationId, `${path}[${i}]`));
    return;
  }
  if (value === null || typeof value !== "object" || value instanceof Date) return;
  for (const [key, v] of Object.entries(value)) {
    if (key === "organisationId" && v !== organisationId) {
      throw new TenantScopeError(`${path}.organisationId must be the current organisation`);
    }
    if (key === "organisation") {
      throw new TenantScopeError(
        `${path}.organisation: set organisationId through the scoped client`,
      );
    }
    assertWriteStaysInTenant(v, organisationId, `${path}.${key}`);
  }
}

// Relations on User that would reveal other organisations or credentials.
const USER_PRIVATE_RELATIONS = new Set([
  "sessions",
  "accounts",
  "memberships",
  "invitations",
  "invitationsSent",
  "invitationsAccepted",
]);
const USER_RELATION_KEYS = new Set(["user", "invitedBy", "acceptedBy"]);

// Organisation fields only a platform admin may change (ADMIN01, BILL01), so an
// organisation admin can never approve their own organisation or pick a plan.
const PLATFORM_ONLY_ORG_FIELDS = [
  "status",
  "planId",
  "reviewedAt",
  "rejectionReason",
  "applicantName",
  "applicantEmail",
];

function assertOrgUpdateAllowed(data: unknown): void {
  const d = (data ?? {}) as Record<string, unknown>;
  for (const key of PLATFORM_ONLY_ORG_FIELDS) {
    if (key in d) throw new TenantScopeError(`Organisation.${key} is platform-only`);
  }
  const type = d.type && typeof d.type === "object" ? (d.type as { set?: unknown }).set : d.type;
  if (type === "platform") {
    throw new TenantScopeError("Organisation.type cannot be set to platform");
  }
}

function assertNoUserPrivateRelations(tree: unknown, atUser: boolean): void {
  if (tree === null || typeof tree !== "object") return;
  for (const [key, v] of Object.entries(tree)) {
    if (atUser && USER_PRIVATE_RELATIONS.has(key)) {
      throw new TenantScopeError(`User.${key} is not readable from a scoped client`);
    }
    if (v && typeof v === "object") {
      const nested = v as { include?: unknown; select?: unknown };
      const intoUser = USER_RELATION_KEYS.has(key);
      assertNoUserPrivateRelations(nested.include, intoUser);
      assertNoUserPrivateRelations(nested.select, intoUser);
    }
  }
}

function withOrg(data: unknown, organisationId: string): unknown {
  assertWriteStaysInTenant(data, organisationId);
  return { ...(data as object), organisationId };
}

export function scopedDb(organisationId: string) {
  if (!organisationId) throw new TenantScopeError("organisationId is required");
  const scope = { organisationId };

  return rawDb.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const a = { ...(args as Args) };
          assertNoUserPrivateRelations(a.include, model === "User");
          assertNoUserPrivateRelations(a.select, model === "User");

          if (FORBIDDEN.has(model)) {
            throw new TenantScopeError(`${model} is not reachable from a scoped client`);
          }

          if (model === "Organisation") {
            if (!["findUnique", "findUniqueOrThrow", "findFirst", "update"].includes(operation)) {
              throw new TenantScopeError(`Organisation.${operation} is not allowed when scoped`);
            }
            if (operation === "update") {
              assertWriteStaysInTenant(a.data, organisationId);
              assertOrgUpdateAllowed(a.data);
            }
            // Keep the caller's where as an AND, so asking for another
            // organisation's id matches nothing rather than this one.
            a.where = UNIQUE_WHERE_OPS.has(operation)
              ? { id: organisationId, AND: [a.where ?? {}] }
              : andWhere(a.where, { id: organisationId });
            return query(a);
          }

          if (model === "User") {
            if (!READ_OPS.has(operation) || operation.startsWith("findUnique")) {
              // findUnique cannot take a relation filter, so use findFirst.
              throw new TenantScopeError(
                `User.${operation} is not allowed when scoped; use findFirst`,
              );
            }
            a.where = andWhere(a.where, { memberships: { some: scope } });
            return query(a);
          }

          if (!TENANT_SCOPED.has(model)) {
            throw new TenantScopeError(`${model} has no tenant scope defined`);
          }

          if (UNIQUE_WHERE_OPS.has(operation)) {
            const where = (a.where ?? {}) as { organisationId?: unknown };
            if (where.organisationId !== undefined && where.organisationId !== organisationId) {
              throw new TenantScopeError(`${model}.${operation}: where names another organisation`);
            }
            a.where = { ...where, ...scope };
          } else if (WHERE_OPS.has(operation)) {
            a.where = andWhere(a.where, scope);
          }

          switch (operation) {
            case "create":
              a.data = withOrg(a.data, organisationId);
              break;
            case "createMany":
            case "createManyAndReturn":
              a.data = Array.isArray(a.data)
                ? a.data.map((d) => withOrg(d, organisationId))
                : withOrg(a.data, organisationId);
              break;
            case "update":
            case "updateMany":
            case "updateManyAndReturn":
              assertWriteStaysInTenant(a.data, organisationId);
              break;
            case "upsert":
              a.create = withOrg(a.create, organisationId);
              assertWriteStaysInTenant(a.update, organisationId, "update");
              break;
          }

          return query(a);
        },
      },
    },
  });
}

export type ScopedDb = ReturnType<typeof scopedDb>;
