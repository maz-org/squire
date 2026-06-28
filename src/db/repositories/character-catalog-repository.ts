/**
 * Campaign-managed catalogs for structured character state.
 *
 * Catalog rows override the default source-data availability. The card tables
 * remain the canonical definitions; these rows only say whether a campaign has
 * made a source id available to character sheets.
 */
import { and, eq, sql } from 'drizzle-orm';

import type { DbOrTx } from '../../auth/audit.ts';
import { campaignItemCatalog, campaignPersonalQuestCatalog } from '../schema/campaigns.ts';
import type { CampaignCatalogEntry, CampaignCatalogStatus } from './types.ts';

type CatalogRow = typeof campaignItemCatalog.$inferSelect;

function toCatalogEntry(row: CatalogRow): CampaignCatalogEntry {
  return {
    id: row.id,
    campaignId: row.campaignId,
    game: row.game,
    sourceId: row.sourceId,
    status: row.status as CampaignCatalogStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listItemCatalog(
  handle: DbOrTx,
  campaignId: string,
): Promise<CampaignCatalogEntry[]> {
  const rows = await handle
    .select()
    .from(campaignItemCatalog)
    .where(eq(campaignItemCatalog.campaignId, campaignId));
  return rows.map(toCatalogEntry);
}

export async function listPersonalQuestCatalog(
  handle: DbOrTx,
  campaignId: string,
): Promise<CampaignCatalogEntry[]> {
  const rows = await handle
    .select()
    .from(campaignPersonalQuestCatalog)
    .where(eq(campaignPersonalQuestCatalog.campaignId, campaignId));
  return rows.map(toCatalogEntry);
}

export async function findItemStatus(
  handle: DbOrTx,
  input: { campaignId: string; game: string; sourceId: string },
): Promise<CampaignCatalogStatus | null> {
  const rows = await handle
    .select({ status: campaignItemCatalog.status })
    .from(campaignItemCatalog)
    .where(
      and(
        eq(campaignItemCatalog.campaignId, input.campaignId),
        eq(campaignItemCatalog.game, input.game),
        eq(campaignItemCatalog.sourceId, input.sourceId),
      ),
    )
    .limit(1);
  return (rows[0]?.status as CampaignCatalogStatus | undefined) ?? null;
}

export async function findPersonalQuestStatus(
  handle: DbOrTx,
  input: { campaignId: string; game: string; sourceId: string },
): Promise<CampaignCatalogStatus | null> {
  const rows = await handle
    .select({ status: campaignPersonalQuestCatalog.status })
    .from(campaignPersonalQuestCatalog)
    .where(
      and(
        eq(campaignPersonalQuestCatalog.campaignId, input.campaignId),
        eq(campaignPersonalQuestCatalog.game, input.game),
        eq(campaignPersonalQuestCatalog.sourceId, input.sourceId),
      ),
    )
    .limit(1);
  return (rows[0]?.status as CampaignCatalogStatus | undefined) ?? null;
}

export async function upsertItemStatus(
  handle: DbOrTx,
  input: { campaignId: string; game: string; sourceId: string; status: CampaignCatalogStatus },
): Promise<CampaignCatalogEntry> {
  const [row] = await handle
    .insert(campaignItemCatalog)
    .values(input)
    .onConflictDoUpdate({
      target: [
        campaignItemCatalog.campaignId,
        campaignItemCatalog.game,
        campaignItemCatalog.sourceId,
      ],
      set: { status: input.status, updatedAt: sql`now()` },
    })
    .returning();
  return toCatalogEntry(row);
}

export async function upsertPersonalQuestStatus(
  handle: DbOrTx,
  input: { campaignId: string; game: string; sourceId: string; status: CampaignCatalogStatus },
): Promise<CampaignCatalogEntry> {
  const [row] = await handle
    .insert(campaignPersonalQuestCatalog)
    .values(input)
    .onConflictDoUpdate({
      target: [
        campaignPersonalQuestCatalog.campaignId,
        campaignPersonalQuestCatalog.game,
        campaignPersonalQuestCatalog.sourceId,
      ],
      set: { status: input.status, updatedAt: sql`now()` },
    })
    .returning();
  return toCatalogEntry(row);
}
