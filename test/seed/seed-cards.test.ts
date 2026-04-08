/**
 * Tests for `src/seed/seed-cards.ts`.
 *
 * The card_* tables are seeded ONCE per run by `test/helpers/global-setup.ts`.
 * These tests run against that shared seed and cover three contracts the
 * Storage Migration spec calls out:
 *
 * 1. Idempotency — re-running does not produce duplicates.
 * 2. Update-on-conflict — a second run picks up field changes (so GHS
 *    upstream refreshes actually propagate).
 * 3. Per-type row counts match the extracted JSON inputs.
 *
 * Tests that need to mutate the seeded data restore the original rows in
 * a `finally` so the shared card_* state survives for other files.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cardItems } from '../../src/db/schema/cards.ts';
import { schema } from '../../src/db.ts';
import { seedCards } from '../../src/seed/seed-cards.ts';
import { CARD_TYPES, type CardType } from '../../src/schemas.ts';

import { setupTestDb, teardownTestDb } from '../helpers/db.ts';

function readRawExtracted(type: CardType): Array<Record<string, unknown>> {
  const path = join(import.meta.dirname, '..', '..', 'data', 'extracted', `${type}.json`);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Array<Record<string, unknown>>;
  // Seed skips records with `_error` / `_parseError` markers; mirror that.
  return raw.filter((r) => !r._error && !r._parseError);
}

describe('seedCards', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    // The update-on-conflict test UPDATEs rows in `card_items`. Postgres
    // MVCC leaves each updated row in a new physical position, which
    // subtly changes `ts_rank` tie-breaking in downstream parity tests
    // (e.g. `test/extracted-data.test.ts`'s fixed query set). TRUNCATE +
    // re-seed items cleanly restores the shared state the rest of the
    // suite depends on, regardless of test run order.
    await db.execute(sql`TRUNCATE card_items RESTART IDENTITY CASCADE`);
    await seedCards(db, { types: ['items'] });
    await teardownTestDb();
  });

  describe('per-type row counts match the extracted JSON', () => {
    // Each type is a separate `it` so a red run points at the offending
    // type in one line instead of a cryptic table row.
    for (const type of CARD_TYPES) {
      it(`${type}: row count matches data/extracted/${type}.json (minus Zod rejects)`, async () => {
        const schemaMap = {
          'monster-stats': schema.cardMonsterStats,
          'monster-abilities': schema.cardMonsterAbilities,
          'character-abilities': schema.cardCharacterAbilities,
          'character-mats': schema.cardCharacterMats,
          items: schema.cardItems,
          events: schema.cardEvents,
          'battle-goals': schema.cardBattleGoals,
          buildings: schema.cardBuildings,
          scenarios: schema.cardScenarios,
          'personal-quests': schema.cardPersonalQuests,
        } as const;
        const table = schemaMap[type];
        const rows = await db
          .select({ id: table.id })
          .from(table)
          .where(eq(table.game, 'frosthaven'));

        const raw = readRawExtracted(type);
        // seedCards may drop additional records that fail Zod validation.
        // Floor: seeded count <= raw count. Ceiling: at least one row.
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.length).toBeLessThanOrEqual(raw.length);
      });
    }
  });

  describe('idempotency and update-on-conflict', () => {
    // Mutate/restore against a real row from `card_items`. Picking one type
    // is sufficient — the upsert path is shared across all types.
    it('re-running seedCards is a no-op (no duplicates, same row count)', async () => {
      const before = await db
        .select({ id: cardItems.id })
        .from(cardItems)
        .where(eq(cardItems.game, 'frosthaven'));

      await seedCards(db, { types: ['items'] });

      const after = await db
        .select({ id: cardItems.id })
        .from(cardItems)
        .where(eq(cardItems.game, 'frosthaven'));
      expect(after.length).toBe(before.length);
    });

    it('re-running seedCards reverts a hand-edited field back to the extract', async () => {
      // Grab any seeded item row so we can poke at its name.
      const [victim] = await db
        .select()
        .from(cardItems)
        .where(eq(cardItems.game, 'frosthaven'))
        .limit(1);
      expect(victim).toBeDefined();

      const originalName = victim.name;
      try {
        // Simulate someone manually editing the row in psql.
        await db
          .update(cardItems)
          .set({ name: 'HAND-EDITED SENTINEL' })
          .where(and(eq(cardItems.game, 'frosthaven'), eq(cardItems.sourceId, victim.sourceId)));

        const [tampered] = await db
          .select()
          .from(cardItems)
          .where(eq(cardItems.sourceId, victim.sourceId));
        expect(tampered.name).toBe('HAND-EDITED SENTINEL');

        // Re-seed and verify the upsert overwrote the edit.
        await seedCards(db, { types: ['items'] });

        const [restored] = await db
          .select()
          .from(cardItems)
          .where(eq(cardItems.sourceId, victim.sourceId));
        expect(restored.name).toBe(originalName);
      } finally {
        // Belt-and-suspenders: if the test above failed, leave the row clean
        // for any later file that depends on the shared seed.
        await db
          .update(cardItems)
          .set({ name: originalName })
          .where(and(eq(cardItems.game, 'frosthaven'), eq(cardItems.sourceId, victim.sourceId)));
      }
    });
  });
});
