import type { audit } from "../audit";

/** The transaction client audit(entry, tx) takes. */
type AuditTx = NonNullable<Parameters<typeof audit>[1]>;

/**
 * A scoped client's interactive transaction, typed for audit(entry, tx). The
 * extended client's transaction type is not Prisma.TransactionClient, but it
 * is the same client at runtime, and the tenant-scope query extension still
 * applies inside it, so the audit row is checked against the organisation too
 * (tests/integration/squad-teams.test.ts checks it lands in the transaction).
 */
export function asTransactionClient(tx: unknown): AuditTx {
  return tx as AuditTx;
}
