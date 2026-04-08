/**
 * Seed `card_*` tables from `data/extracted/<type>.json`.
 *
 * Bridge module landed in SQR-55 ahead of the SQR-56 `extracted-data.ts`
 * rewrite. The seed reads the same JSON files that `extracted-data.ts`
 * currently reads, validates each record against the matching `SCHEMAS[type]`
 * Zod schema, and upserts via `(game, source_id)` so the operation is
 * idempotent. Per-type writes are wrapped in their own transaction so a
 * partial failure rolls back only that type.
 *
 * See `docs/plans/sqr-34-execution.md` §Session A — SQR-55 for context.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { and, eq, getTableColumns, notInArray, sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';

/**
 * Every `card_*` table has `game` and `sourceId` columns by construction
 * (see `src/db/schema/cards.ts`). Drizzle's `PgTable` type erases the
 * per-table column shape, so we narrow once with this alias instead of
 * sprinkling `@ts-expect-error` at every conflict-target call site.
 */
type CardTable = PgTable & { game: AnyPgColumn; sourceId: AnyPgColumn };

import type { Db } from '../db.ts';
import {
  cardBattleGoals,
  cardBuildings,
  cardCharacterAbilities,
  cardCharacterMats,
  cardEvents,
  cardItems,
  cardMonsterAbilities,
  cardMonsterStats,
  cardPersonalQuests,
  cardScenarios,
} from '../db/schema/cards.ts';
import { CARD_TYPES, SCHEMAS, type CardType } from '../schemas.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTRACTED_DIR = join(__dirname, '..', '..', 'data', 'extracted');

// Map each card type to its Drizzle table. Centralizing the mapping here
// keeps the seed and the (future) `extracted-data.ts` rewrite in lockstep.
const TYPE_TO_TABLE: Record<CardType, PgTable> = {
  'monster-stats': cardMonsterStats,
  'monster-abilities': cardMonsterAbilities,
  'character-abilities': cardCharacterAbilities,
  'character-mats': cardCharacterMats,
  items: cardItems,
  events: cardEvents,
  'battle-goals': cardBattleGoals,
  buildings: cardBuildings,
  scenarios: cardScenarios,
  'personal-quests': cardPersonalQuests,
};

export interface SeedCardsOptions {
  /** Game key written to every row. Defaults to `'frosthaven'`. */
  game?: string;
  /** Restrict to a subset of card types. Defaults to all 10. */
  types?: CardType[];
}

export interface SeedCardsResult {
  type: CardType;
  inserted: number;
  /** Rows pruned because they no longer appear in the latest extract. */
  pruned: number;
  skipped: number;
}

/**
 * Seed/upsert all (or a subset of) card tables from the JSON extracts.
 * Returns per-type counts so callers can print a summary.
 */
export async function seedCards(db: Db, opts: SeedCardsOptions = {}): Promise<SeedCardsResult[]> {
  const game = opts.game ?? 'frosthaven';
  const types = opts.types ?? CARD_TYPES;
  const results: SeedCardsResult[] = [];

  for (const type of types) {
    const table = TYPE_TO_TABLE[type] as CardTable;
    const schema = SCHEMAS[type];
    const path = join(EXTRACTED_DIR, `${type}.json`);
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Array<Record<string, unknown>>;

    const rows: Record<string, unknown>[] = [];
    let skipped = 0;
    for (const record of raw) {
      // Skip records the extractor flagged as unusable.
      if (record._error || record._parseError) {
        skipped++;
        continue;
      }
      const parsed = schema.safeParse(record);
      if (!parsed.success) {
        skipped++;
        console.warn(
          `[seed-cards] ${type}: skip ${record.sourceId ?? '<no id>'} — ${parsed.error.message}`,
        );
        continue;
      }
      rows.push({ ...(parsed.data as Record<string, unknown>), game });
    }

    // Build the conflict-update set from all non-key columns. Drizzle's
    // `excluded.<col>` reference uses the schema column name, not the SQL
    // column name, which is exactly what `getTableColumns` returns.
    const allCols = getTableColumns(table);
    const updateSet: Record<string, unknown> = {};
    for (const colName of Object.keys(allCols)) {
      if (colName === 'id' || colName === 'game' || colName === 'sourceId') continue;
      updateSet[colName] = sql.raw(`excluded."${allCols[colName].name}"`);
    }

    // Prune any rows for this game that no longer appear in the latest
    // extract (or that started failing Zod validation since the last seed).
    // Without this, deleted/renamed source records would survive forever
    // and become live data once SQR-56 swaps the loader to Postgres.
    const sourceIds = rows.map((row) => row.sourceId as string);
    const pruned = await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(table)
        .where(
          sourceIds.length === 0
            ? eq(table.game, game)
            : and(eq(table.game, game), notInArray(table.sourceId, sourceIds)),
        )
        .returning({ sourceId: table.sourceId });

      if (rows.length > 0) {
        await tx
          .insert(table)
          .values(rows)
          .onConflictDoUpdate({
            target: [table.game, table.sourceId],
            set: updateSet,
          });
      }

      return deleted.length;
    });

    results.push({ type, inserted: rows.length, pruned, skipped });
  }

  return results;
}
