/**
 * Campaign repository (Phase 4, SQR-18).
 *
 * Persistence boundary for `campaigns` rows. Membership checks live in
 * campaign-member-repository; SERVICE-layer code composes the two — nothing
 * here implies authorization. Shared-state writes use optimistic CAS per eng
 * decision E3: callers pass `expectedVersion`, a mismatch throws
 * VersionConflictError, and every successful write bumps `version`.
 */
import { and, eq, sql } from 'drizzle-orm';

import { getDb } from '../../db.ts';
import type { DbOrTx } from '../../auth/audit.ts';
import { campaigns } from '../schema/campaigns.ts';
import {
  VersionConflictError,
  type Campaign,
  type UpdateCampaignSharedStateInput,
} from './types.ts';

type CampaignRow = typeof campaigns.$inferSelect;

function toDomain(row: CampaignRow): Campaign {
  return {
    id: row.id,
    name: row.name,
    game: row.game,
    modules: row.modules,
    prosperity: row.prosperity,
    activeScenario: row.activeScenario,
    playedScenarios: row.playedScenarios,
    drawnScenarios: row.drawnScenarios,
    skippedScenarios: row.skippedScenarios,
    unlockedClasses: row.unlockedClasses,
    unlockedItems: row.unlockedItems,
    unlockedBuildings: row.unlockedBuildings,
    version: row.version,
    lastSyncedAt: row.lastSyncedAt,
    syncMethod: row.syncMethod,
    externalRef: row.externalRef,
    sourceAuthority: row.sourceAuthority,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findById(campaignId: string): Promise<Campaign | null> {
  const { db } = getDb('server');
  const rows = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function create(
  handle: DbOrTx,
  input: { name: string; game: string; modules?: string[] },
): Promise<Campaign> {
  const [row] = await handle
    .insert(campaigns)
    .values({
      name: input.name,
      game: input.game,
      modules: input.modules ?? [],
    })
    .returning();
  return toDomain(row);
}

/**
 * Optimistic compare-and-set shared-state write (E3). The UPDATE is guarded
 * on `version = expectedVersion`; zero affected rows means a concurrent
 * writer won and the caller must re-read and retry.
 */
export async function updateSharedState(
  handle: DbOrTx,
  campaignId: string,
  input: UpdateCampaignSharedStateInput,
): Promise<Campaign> {
  const { expectedVersion, ...patch } = input;
  const [row] = await handle
    .update(campaigns)
    .set({
      ...patch,
      version: sql`${campaigns.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.version, expectedVersion)))
    .returning();
  if (!row) {
    throw new VersionConflictError(campaignId);
  }
  return toDomain(row);
}

export async function remove(handle: DbOrTx, campaignId: string): Promise<boolean> {
  const deleted = await handle
    .delete(campaigns)
    .where(eq(campaigns.id, campaignId))
    .returning({ id: campaigns.id });
  return deleted.length > 0;
}
