/**
 * Apply pending Drizzle migrations against the database in `DATABASE_URL`
 * (defaults to the local docker-compose Postgres). Used by `npm run db:migrate`
 * and by CI before integration tests run.
 */
import 'dotenv/config';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { resolveDatabaseUrl } from '../src/db.ts';

const { Pool } = pg;

async function main(): Promise<void> {
  // `resolveDatabaseUrl()` picks the right default based on the environment:
  // - `NODE_ENV=test` (or `VITEST=true`) → test DB, overridable via TEST_DATABASE_URL
  // - anything else → dev DB, overridable via DATABASE_URL
  //
  // This keeps `npm run db:migrate` and `npm run db:migrate:test` in sync
  // with the rest of the app's URL resolution — no more explicit
  // `DATABASE_URL=...` incantations for the test database.
  const url = resolveDatabaseUrl();
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: './src/db/migrations' });
    console.log(`✓ migrations applied to ${redact(url)}`);
  } finally {
    await pool.end();
  }
}

function redact(url: string): string {
  return url.replace(/\/\/[^@]*@/, '//***:***@');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
