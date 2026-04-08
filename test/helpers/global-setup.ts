/**
 * Vitest globalSetup — runs ONCE before any test file, in its own process.
 *
 * Seeds the `card_*` tables from `data/extracted/*.json` so DB-backed tests
 * (`extracted-data.test.ts`, `tools.test.ts`) can read real card data without
 * each file racing to TRUNCATE+seed in parallel. Per-file seeding caused
 * interleaved truncates to wipe rows mid-test under vitest's parallel runner.
 *
 * The card tables are read-only for tests, so a single seed at the start of
 * the run is sufficient. Other tables that mutate during tests
 * (`embeddings`, oauth_*, etc.) are still reset per-test by `resetTestDb`.
 */
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { resolveDatabaseUrl, schema } from '../../src/db.ts';
import { seedCards } from '../../src/seed/seed-cards.ts';

const { Pool } = pg;

export default async function globalSetup(): Promise<void> {
  const pool = new Pool({ connectionString: resolveDatabaseUrl(), max: 2 });
  try {
    const db = drizzle(pool, { schema });
    await db.execute(sql`
      TRUNCATE
        card_monster_stats, card_monster_abilities,
        card_character_abilities, card_character_mats,
        card_items, card_events, card_battle_goals,
        card_buildings, card_scenarios, card_personal_quests
        RESTART IDENTITY CASCADE
    `);
    await seedCards(db);
  } finally {
    await pool.end();
  }
}
