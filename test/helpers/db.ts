/**
 * Test DB helpers per tech spec §"Test strategy (Decision 10)".
 *
 * Every test file that hits Postgres calls `setupTestDb()` once in `beforeAll`
 * and `resetTestDb()` in `beforeEach`. Seeding goes through the same seed
 * scripts / library functions the prod flow uses, so seed code is
 * test-verified for free.
 *
 * Connection URL resolution piggybacks on `src/db.ts#resolveDatabaseUrl()`,
 * which picks the test DB automatically under vitest (`VITEST=true`). No
 * explicit `DATABASE_URL=...` incantation required.
 */
import { sql } from 'drizzle-orm';

import { createStandaloneDb, resolveDatabaseUrl } from '../../src/db.ts';

let db: ReturnType<typeof createStandaloneDb>['db'] | null = null;
let closeDb: (() => Promise<void>) | null = null;

export async function setupTestDb(): Promise<ReturnType<typeof createStandaloneDb>['db']> {
  if (!db) {
    const url = resolveDatabaseUrl();
    // Fail-fast guard mirroring `test/helpers/global-setup.ts` — refuse to
    // hand back a pool pointing at anything that isn't a *_test database.
    // Tests truncate via this pool, so a misconfigured env could otherwise
    // wipe real data.
    if (!/_test(\?|$)/.test(url) && !/squire_test/.test(url)) {
      throw new Error(
        `[setupTestDb] resolved DB URL does not look like a test DB. ` +
          `Got "${url.replace(/:[^:@]*@/, ':***@')}". Set DATABASE_URL/TEST_DATABASE_URL to a *_test database.`,
      );
    }
    const handle = createStandaloneDb({ url, max: 2 });
    db = handle.db;
    closeDb = handle.close;
  }
  return db!;
}

/**
 * Fast reset for mutable tables. Most DB tests create only a few rows, so
 * ordered DELETEs are far cheaper than TRUNCATE's lock-heavy FK/identity work.
 * Globally seeded card and scenario-section fixture tables are intentionally
 * left alone here. Most tests read them only; tests that mutate fixture rows
 * own local cleanup so the common reset path stays cheap.
 */
export async function resetTestDb(): Promise<void> {
  if (!db) throw new Error('resetTestDb called before setupTestDb');
  await db.transaction(async (tx) => {
    for (const statement of RESET_TABLE_DELETES) {
      await tx.execute(statement);
    }
  });
}

const RESET_TABLE_DELETES = [
  sql`DELETE FROM message_stream_events`,
  sql`DELETE FROM unlock_graph_threads`,
  sql`DELETE FROM unlock_graph_scenarios`,
  sql`DELETE FROM llm_budget_warnings`,
  sql`DELETE FROM llm_budget_ledger`,
  sql`DELETE FROM messages`,
  sql`DELETE FROM conversations`,
  sql`DELETE FROM rule_source_embeddings`,
  sql`DELETE FROM embeddings`,
  sql`DELETE FROM mutation_idempotency_keys`,
  sql`DELETE FROM pending_mutations`,
  sql`DELETE FROM campaign_audit_log`,
  sql`DELETE FROM character_cards`,
  sql`DELETE FROM character_items`,
  sql`DELETE FROM characters`,
  sql`DELETE FROM campaign_personal_quest_catalog`,
  sql`DELETE FROM campaign_item_catalog`,
  sql`DELETE FROM campaign_members`,
  sql`DELETE FROM campaigns`,
  sql`DELETE FROM oauth_audit_log`,
  sql`DELETE FROM oauth_tokens`,
  sql`DELETE FROM oauth_authorization_codes`,
  sql`DELETE FROM oauth_clients`,
  sql`DELETE FROM sessions`,
  sql`DELETE FROM users`,
];

export async function teardownTestDb(): Promise<void> {
  if (closeDb) {
    await closeDb();
  }
  closeDb = null;
  db = null;
}
