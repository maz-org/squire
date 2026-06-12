/**
 * Campaign audit log repository (Phase 4, SQR-266).
 *
 * Append-only, no FKs (rows outlive their campaign), no update or delete
 * functions on purpose. Success rows are inserted on the mutation's
 * transaction handle; rejected rows on the outer connection after the
 * denial/rollback (ADR 0021 §Audit requirements).
 */
import { desc, eq } from 'drizzle-orm';

import { getDb } from '../../db.ts';
import type { DbOrTx } from '../../auth/audit.ts';
import { campaignAuditLog } from '../schema/campaigns.ts';
import type {
  CampaignAuditEntry,
  CampaignAuditOutcome,
  CreateCampaignAuditInput,
} from './types.ts';

type AuditRow = typeof campaignAuditLog.$inferSelect;

function toDomain(row: AuditRow): CampaignAuditEntry {
  return {
    id: row.id,
    campaignId: row.campaignId,
    actorUserId: row.actorUserId,
    mutationType: row.mutationType,
    channel: row.channel,
    entityType: row.entityType,
    entityId: row.entityId,
    payloadBefore: row.payloadBefore,
    payloadAfter: row.payloadAfter,
    availabilitySnapshot: row.availabilitySnapshot,
    outcome: row.outcome as CampaignAuditOutcome,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
  };
}

export async function insert(
  handle: DbOrTx,
  input: CreateCampaignAuditInput,
): Promise<CampaignAuditEntry> {
  const [row] = await handle
    .insert(campaignAuditLog)
    .values({
      campaignId: input.campaignId,
      actorUserId: input.actorUserId,
      mutationType: input.mutationType,
      channel: input.channel,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      payloadBefore: input.payloadBefore ?? null,
      payloadAfter: input.payloadAfter ?? null,
      availabilitySnapshot: input.availabilitySnapshot ?? null,
      outcome: input.outcome ?? 'success',
      failureReason: input.failureReason ?? null,
    })
    .returning();
  return toDomain(row);
}

/** Newest first; the journal read-model and tests both read through this. */
export async function listByCampaign(
  campaignId: string,
  options: { limit?: number } = {},
): Promise<CampaignAuditEntry[]> {
  const { db } = getDb('server');
  const rows = await db
    .select()
    .from(campaignAuditLog)
    .where(eq(campaignAuditLog.campaignId, campaignId))
    .orderBy(desc(campaignAuditLog.createdAt), desc(campaignAuditLog.id))
    .limit(options.limit ?? 200);
  return rows.map(toDomain);
}
