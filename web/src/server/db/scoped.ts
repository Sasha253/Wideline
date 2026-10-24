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
 *  - refuses the Better Auth tables, the scout tables and the plan,
 *    entitlement and usage tables entirely;
 *  - refuses every update and delete of Consent rows (append-only, CONS01) and
 *    any write of Player.consentState, the cache the Consent trigger keeps.
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
  "Consent",
  "ConsentRequest",
]);

// Tables no organisation may reach: the Better Auth tables, the scout tables
// (AUTH08 to AUTH10), which belong to the scout, not to any organisation, and
// the plan, entitlement and usage tables (C03), which only Wideline changes.
// Scout code uses src/server/scouts/ and src/server/platform/; entitlements use
// src/server/entitlements/ and src/server/usage/.
const FORBIDDEN = new Set<Prisma.ModelName>([
  "Session",
  "Account",
  "Verification",
  "ScoutProfile",
  "ScoutAffiliation",
  "Plan",
  "Subscription",
  "Entitlement",
  "UsageEvent",
]);
const ENTITLEMENTS_REASON =
  "plans and entitlements are set by Wideline; read them with entitlement() or may() from src/server/entitlements/";
const FORBIDDEN_REASON: Partial<Record<Prisma.ModelName, string>> = {
  ScoutProfile: "scout data is global and scout-owned; use src/server/scouts/",
  ScoutAffiliation: "scout data is global and scout-owned; use src/server/scouts/",
  Plan: ENTITLEMENTS_REASON,
  Subscription: ENTITLEMENTS_REASON,
  Entitlement: ENTITLEMENTS_REASON,
  UsageEvent: "usage is recorded with recordUsage() from src/server/usage/meter.ts",
};

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
  "scoutProfile",
  // C05: every consent a user recorded or requested, in any organisation.
  "consentsRecorded",
  "consentRequestsCreated",
]);
const USER_RELATION_KEYS = new Set(["user", "invitedBy", "acceptedBy", "recordedBy", "createdBy"]);

// C05 (CONS01, PRD "Rules the schema must enforce"): consent rows are never
// edited in place. The database refuses it too (trigger "Consent_append_only");
// this fails earlier, with a clearer message.
const CONSENT_REFUSED_OPS = new Set([
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

/** Throws if a Player write sets consentState: only the Consent trigger writes it. */
function assertNoConsentStateWrite(value: unknown, path: string): void {
  const rows = Array.isArray(value) ? value : [value];
  for (const row of rows) {
    if (row && typeof row === "object" && "consentState" in row) {
      throw new TenantScopeError(
        `${path}.consentState: Player.consentState is set by recording a Consent row`,
      );
    }
  }
}

// The only Organisation fields a scoped client may change: the settings an
// organisation edits itself. Everything else is refused, so an organisation
// admin can never approve their own organisation or pick a plan (ADMIN01,
// BILL01), and no nested relation write (connect, create, ...) can reach
// another organisation's rows (NFR16).
const SCOPED_ORG_FIELDS = new Set(["name", "type", "country", "region", "settings"]);

// Relations on Organisation that would reveal scout data (which scouts declared
// a conflict with this organisation), or plan data and the platform admins'
// internal override notes (C03).
const ORG_PRIVATE_RELATIONS = new Set([
  "scoutAffiliations",
  "subscription",
  "entitlements",
  "usageEvents",
]);

function assertOrgUpdateAllowed(data: unknown): void {
  const d = (data ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(d)) {
    if (!SCOPED_ORG_FIELDS.has(key)) {
      throw new TenantScopeError(`Organisation.${key} cannot be changed from a scoped client`);
    }
  }
  const type = d.type && typeof d.type === "object" ? (d.type as { set?: unknown }).set : d.type;
  if (type === "platform" || type === "scout_network") {
    throw new TenantScopeError(`Organisation.type cannot be set to ${type}`);
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

/** Throws if an include or select names a private Organisation relation, at any depth. */
function assertNoOrgPrivateRelations(tree: unknown): void {
  if (tree === null || typeof tree !== "object") return;
  for (const [key, v] of Object.entries(tree)) {
    if (ORG_PRIVATE_RELATIONS.has(key)) {
      throw new TenantScopeError(`Organisation.${key} is not readable from a scoped client`);
    }
    if (v && typeof v === "object") {
      const nested = v as { include?: unknown; select?: unknown };
      assertNoOrgPrivateRelations(nested.include);
      assertNoOrgPrivateRelations(nested.select);
    }
  }
}

// Relation filters that would let a scoped query test scout data ("clubs some
// scout declared"), so they are refused anywhere in a where clause.
const SCOUT_RELATION_FILTERS = new Set(["scoutAffiliations", "scoutProfile"]);
// Likewise for plan and entitlement data, such as the text of an override note.
const ENTITLEMENT_RELATION_FILTERS = new Set(["subscription", "entitlements", "usageEvents"]);

function assertNoScoutFilters(where: unknown, path = "where"): void {
  if (Array.isArray(where)) {
    where.forEach((w, i) => assertNoScoutFilters(w, `${path}[${i}]`));
    return;
  }
  if (where === null || typeof where !== "object" || where instanceof Date) return;
  for (const [key, v] of Object.entries(where)) {
    if (SCOUT_RELATION_FILTERS.has(key)) {
      throw new TenantScopeError(`${path}.${key}: scout data cannot be filtered on when scoped`);
    }
    if (ENTITLEMENT_RELATION_FILTERS.has(key)) {
      throw new TenantScopeError(`${path}.${key}: plan data cannot be filtered on when scoped`);
    }
    assertNoScoutFilters(v, `${path}.${key}`);
  }
}

/**
 * Checks the where of every relation in an include or select tree, at any
 * depth (include: { memberships: { where } }, _count: { select: { x: { where } } }).
 */
function assertNoNestedScoutFilters(tree: unknown, path: string): void {
  if (tree === null || typeof tree !== "object") return;
  for (const [key, v] of Object.entries(tree)) {
    if (!v || typeof v !== "object") continue;
    const nested = v as { where?: unknown; include?: unknown; select?: unknown };
    assertNoScoutFilters(nested.where, `${path}.${key}.where`);
    assertNoNestedScoutFilters(nested.include, `${path}.${key}.include`);
    assertNoNestedScoutFilters(nested.select, `${path}.${key}.select`);
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
          assertNoOrgPrivateRelations(a.include);
          assertNoOrgPrivateRelations(a.select);
          assertNoScoutFilters(a.where);
          assertNoNestedScoutFilters(a.include, "include");
          assertNoNestedScoutFilters(a.select, "select");

          if (FORBIDDEN.has(model)) {
            const reason = FORBIDDEN_REASON[model];
            throw new TenantScopeError(
              `${model} is not reachable from a scoped client${reason ? `: ${reason}` : ""}`,
            );
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

          if (model === "Consent" && CONSENT_REFUSED_OPS.has(operation)) {
            throw new TenantScopeError(
              `Consent.${operation}: Consent is append-only; record a new row instead`,
            );
          }
          if (model === "Player") {
            assertNoConsentStateWrite(a.data, "data");
            assertNoConsentStateWrite(a.create, "create");
            assertNoConsentStateWrite(a.update, "update");
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
