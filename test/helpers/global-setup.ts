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

import { createStandaloneDb, resolveDatabaseUrl } from '../../src/db.ts';
import { seedCards } from '../../src/seed/seed-cards.ts';
import { seedTraversal } from '../../src/seed/seed-traversal.ts';

export default async function globalSetup(): Promise<void> {
  const url = resolveDatabaseUrl();
  // Fail-fast guard: refuse to TRUNCATE anything that isn't a *_test DB.
  // resolveDatabaseUrl picks the test DB under VITEST=true, but a
  // misconfigured env (or running this file outside vitest) could otherwise
  // wipe a real database.
  if (!/_test(\?|$)/.test(url) && !/squire_test/.test(url)) {
    throw new Error(
      `[global-setup] refusing to TRUNCATE: resolved DB URL does not look like a test DB. ` +
        `Got "${url.replace(/:[^:@]*@/, ':***@')}". Set DATABASE_URL/TEST_DATABASE_URL to a *_test database.`,
    );
  }
  const handle = createStandaloneDb({ url, max: 2 });
  try {
    const { db } = handle;
    await db.execute(sql`
      TRUNCATE
        card_monster_stats, card_monster_abilities,
        card_character_abilities, card_character_mats,
        card_items, card_events, card_battle_goals,
        card_buildings, card_scenarios, card_personal_quests,
        traversal_links, traversal_sections, traversal_scenarios
        RESTART IDENTITY CASCADE
    `);
    await seedCards(db);
    await seedTraversal(db);
  } finally {
    await handle.close();
  }
}
