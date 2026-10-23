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
 * because some events (logins) have no organisation.
 *
 * Without tx, an audit failure is logged and never breaks the action being
 * audited. With tx (an interactive transaction client), the row is written in
 * that transaction and a failure throws, so the action and its audit row
 * commit together or not at all. Use tx for decisions that must be audited
 * (approvals, rejections, suspensions).
 */
export async function audit(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
  const data = { ...entry, metadata: entry.metadata ?? {} };
  if (tx) {
    await tx.auditLog.create({ data });
    return;
  }
  try {
    await rawDb.auditLog.create({ data });
  } catch (err) {
    log.error({ err, action: entry.action }, "audit write failed");
  }
}
