/**
 * Audited campaign mutations (SQR-266, ADR 0021 §Audit requirements).
 *
 * `auditedMutation` is the one way campaign/character state changes: the
 * mutation and its audit row commit in the SAME transaction (a mutation
 * without evidence cannot exist), while denials and rollbacks write their
 * 'rejected' row on the outer connection AFTER the transaction unwinds, so
 * the evidence survives the rollback — mirroring the failure-audit pattern
 * in src/auth/provider.ts.
 *
 * Rejections with no campaign to attribute (e.g. accepting an invite id
 * that resolves to nothing) are not auditable here — the audit table keys
 * rows by campaign — and stay visible through the security log instead.
 */
import { getDb } from '../db.ts';
import type { Db } from '../db.ts';
import type { DbOrTx } from '../auth/audit.ts';
import * as CampaignAuditRepository from '../db/repositories/campaign-audit-repository.ts';
import type { CallerIdentity } from './identity.ts';

export interface AuditedMutationMeta {
  /** Omit only when the campaign id is unknown until the mutation runs. */
  campaignId?: string;
  mutationType: string;
  entityType: string;
  entityId?: string | null;
}

export interface AuditedMutationOutcome<T> {
  result: T;
  /** Late-resolved ids (campaign create, invite accept). */
  campaignId?: string;
  entityId?: string | null;
  payloadBefore?: Record<string, unknown> | null;
  payloadAfter?: Record<string, unknown> | null;
  availabilitySnapshot?: Record<string, unknown> | null;
}

function failureReasonFor(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
    if (error instanceof Error && error.name === 'VersionConflictError') {
      return 'version_conflict';
    }
    if (error instanceof Error) return error.name;
  }
  return 'unknown';
}

async function recordRejected(
  identity: CallerIdentity,
  meta: AuditedMutationMeta,
  error: unknown,
): Promise<void> {
  if (!meta.campaignId) return;
  try {
    const { db } = getDb('server');
    await CampaignAuditRepository.insert(db, {
      campaignId: meta.campaignId,
      actorUserId: identity.userId,
      mutationType: meta.mutationType,
      channel: identity.channel,
      entityType: meta.entityType,
      entityId: meta.entityId ?? null,
      outcome: 'rejected',
      failureReason: failureReasonFor(error),
    });
  } catch (auditError) {
    // Evidence writes must never mask the original failure.
    console.error('[campaign-audit] failed to record rejected mutation:', auditError);
  }
}

export async function auditedMutation<T>(
  identity: CallerIdentity,
  meta: AuditedMutationMeta,
  fn: (tx: DbOrTx) => Promise<AuditedMutationOutcome<T>>,
  /**
   * Batch execution (SQR-283): when a confirmed batch supplies its outer
   * transaction, the mutation+audit pair runs as a SAVEPOINT inside it, so
   * the whole batch commits or unwinds together. Failure evidence still
   * lands via `recordRejected` on the outer connection.
   */
  runIn?: DbOrTx,
): Promise<T> {
  const { db } = getDb('server');
  const runner = (runIn ?? db) as Db;
  try {
    return await runner.transaction(async (tx) => {
      const outcome = await fn(tx);
      const campaignId = outcome.campaignId ?? meta.campaignId;
      if (!campaignId) {
        throw new Error(`audited mutation ${meta.mutationType} resolved no campaign id`);
      }
      await CampaignAuditRepository.insert(tx, {
        campaignId,
        actorUserId: identity.userId,
        mutationType: meta.mutationType,
        channel: identity.channel,
        entityType: meta.entityType,
        entityId: outcome.entityId ?? meta.entityId ?? null,
        payloadBefore: outcome.payloadBefore ?? null,
        payloadAfter: outcome.payloadAfter ?? null,
        availabilitySnapshot: outcome.availabilitySnapshot ?? null,
      });
      return outcome.result;
    });
  } catch (error) {
    await recordRejected(identity, meta, error);
    throw error;
  }
}
