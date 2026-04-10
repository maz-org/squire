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
 * Fast reset: truncate in reverse-dependency order. Slower-but-safer
 * transaction-per-test is tracked in the tech spec as a future option.
 */
export async function resetTestDb(): Promise<void> {
  if (!db) throw new Error('resetTestDb called before setupTestDb');
  await db.execute(sql`
    TRUNCATE messages, conversations, embeddings, oauth_audit_log, oauth_tokens,
             oauth_authorization_codes, oauth_clients, sessions, users
             RESTART IDENTITY CASCADE
  `);
}

export async function teardownTestDb(): Promise<void> {
  if (closeDb) {
    await closeDb();
  }
  closeDb = null;
  db = null;
}
