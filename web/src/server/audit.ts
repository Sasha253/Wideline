import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { rawDb } from "./db/raw";
import { log } from "./log";

export type AuditEntry = {
  organisationId: string | null;
  actorUserId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
};

/**
 * Append to the audit log (AUTH-07, NFR-20). Writes through the raw client
 * because some events (logins) have no organisation. Audit failures are logged
 * and never break the action being audited.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await rawDb.auditLog.create({ data: { ...entry, metadata: entry.metadata ?? {} } });
  } catch (err) {
    log.error({ err, action: entry.action }, "audit write failed");
  }
}
