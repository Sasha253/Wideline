import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// The unscoped client. It bypasses tenant scoping, so ESLint restricts which
// files may import it (see eslint.config.mjs). Application code must use
// scopedDb() via requireRole() instead.

const globalForPrisma = globalThis as unknown as { rawDb?: PrismaClient };

function create(): PrismaClient {
  // Connection is lazy, so a missing URL only fails on the first query. That
  // keeps `next build` working without a database.
  const connectionString = process.env.DATABASE_URL ?? "postgresql://unset@localhost/unset";
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export const rawDb: PrismaClient = globalForPrisma.rawDb ?? create();

if (process.env.NODE_ENV !== "production") globalForPrisma.rawDb = rawDb;
