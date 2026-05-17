/**
 * OAuth audit log writer.
 *
 * Auth lifecycle mutations — registration, authorization, code exchange, token
 * verification, revocation — write rows to `oauth_audit_log`. The writer
 * always takes a Drizzle query handle (either a `Db` or a transaction `tx`) so
 * callers can bundle the audit row with the state mutation in a single
 * transaction.
 *
 * The audit table is durable auth evidence, not a generic operational log
 * sink. Denials that do not mutate auth state, such as rate-limit rejections,
 * should be emitted as structured logs instead.
 *
 * Schema: see `src/db/schema/auth.ts#oauthAuditLog`. Required by
 * `docs/SECURITY.md` §2.
 */

import type { Db } from '../db.ts';
import { oauthAuditLog } from '../db/schema/auth.ts';

// The parameter of the transaction callback shares the query-builder surface
// with `Db`, so either works. Pulling the type out keeps the signature honest
// for callers that really are in a transaction.
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export type AuditEventType =
  | 'register'
  | 'authorize'
  | 'code_exchange'
  | 'token_issue'
  | 'token_verify'
  | 'token_revoke'
  | 'token_expired'
  | 'google_login'
  | 'google_login_denied'
  | 'google_logout';

export type AuditOutcome = 'success' | 'failure';

export interface AuditContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditEvent extends AuditContext {
  eventType: AuditEventType;
  clientId?: string | null;
  userId?: string | null;
  outcome: AuditOutcome;
  failureReason?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function writeAuditEvent(db: DbOrTx, event: AuditEvent): Promise<void> {
  await db.insert(oauthAuditLog).values({
    eventType: event.eventType,
    clientId: event.clientId ?? null,
    userId: event.userId ?? null,
    ipAddress: event.ipAddress ?? null,
    userAgent: event.userAgent ?? null,
    outcome: event.outcome,
    failureReason: event.failureReason ?? null,
    metadata: event.metadata ?? null,
  });
}
