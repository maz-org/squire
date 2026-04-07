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
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { resolveDatabaseUrl, schema } from '../../src/db.ts';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export async function setupTestDb(): Promise<ReturnType<typeof drizzle<typeof schema>>> {
  if (!pool) {
    pool = new Pool({ connectionString: resolveDatabaseUrl(), max: 2 });
    db = drizzle(pool, { schema });
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
    TRUNCATE embeddings, oauth_audit_log, oauth_tokens, oauth_authorization_codes,
             oauth_clients, sessions, users
             RESTART IDENTITY CASCADE
  `);
}

export async function teardownTestDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}
